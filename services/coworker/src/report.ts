import { audit, renderFindings, type Audit } from './audit.js';

const URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.COWORKER_MODEL ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5';

const SYSTEM = `You write the action section of a recovery audit for a company's finance team.
You get findings computed from their card statement. The numbers are final: never change, add or invent amounts, merchants or dates.
For each finding, write one short message the team can send to the merchant (cancel, refund request, or price negotiation), addressed to the merchant's support team, under 90 words, plain text, no placeholders except [account email].
Then add a "Next steps" list of at most four lines, ordered by value.
Use markdown headings "## Messages to send" and "## Next steps". No preamble.`;

async function draft(a: Audit, signal?: AbortSignal): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY;
  if (!key) throw new Error('no model key');
  const findings = a.findings.slice(0, 8).map(({ rows, ...f }) => ({ ...f, amount: (f.cents / 100).toFixed(2), rowCount: rows.length }));
  const res = await fetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Overpaid coworker' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(findings) },
      ],
    }),
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  const body = (await res.json()) as any;
  const text = body?.choices?.[0]?.message?.content;
  if (!res.ok || typeof text !== 'string' || !text.trim()) throw new Error(`model ${res.status}`);
  return text.trim();
}

function fallback(a: Audit): string {
  const lines = ['## Messages to send'];
  for (const f of a.findings.slice(0, 8)) {
    const ask = /subscription/i.test(f.type) ? 'Please cancel this subscription and refund the most recent unused charge.' : /duplicate/i.test(f.type) ? 'Please refund the duplicate charge.' : 'Please move us to your current lower price for the same plan.';
    lines.push('', `**${f.merchant}:** Hello, we were charged as listed below on our company card. ${ask} Account: [account email].`);
  }
  return lines.join('\n');
}

/** Full Task result: sourced findings first, then drafted messages. The model never touches the numbers. */
export async function buildReport(input: string, opts: { today?: string; signal?: AbortSignal } = {}): Promise<{ text: string; audit: Audit; model: string }> {
  const a = await audit(input, opts.today);
  const head = renderFindings(a);
  if (!a.ok || !a.findings.length) return { text: head, audit: a, model: 'none' };
  let actions: string;
  let model = MODEL;
  try {
    actions = await draft(a, opts.signal);
  } catch {
    actions = fallback(a);
    model = 'template';
  }
  const foot = '\n\n---\nOverpaid recovery audit. Findings are computed from the statement rows above; messages are drafts for you to review before sending.';
  return { text: `${head}\n\n${actions}${foot}`, audit: a, model };
}
