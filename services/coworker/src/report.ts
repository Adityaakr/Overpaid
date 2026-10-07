import { audit, kindLabel, renderFindings, type Audit } from './audit.js';

const URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.COWORKER_MODEL ?? process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5';

const SYSTEM = `You write the action section of a money-recovery audit for the owner of a bank or card statement.
You get findings computed from the statement. The numbers are final: never change, add or invent amounts, merchants, dates or savings.
Some findings are certain (duplicates, fees, price increases); recurring charges are only "to review": nobody knows yet whether they are used, so never claim they are unused.
For the top findings (at most 6), write one short message the owner can send: a refund request, a cancellation, a fee waiver, or a request for a better price. Address it to the merchant's or bank's support team, under 80 words, plain text, no placeholders except [account email] and [account number].
Then add "Next steps": at most five lines, ordered by money at stake, each starting with a verb.
Use markdown headings "## Messages to send" and "## Next steps". Put each message under a bold line with the merchant name. No preamble.`;

async function draft(a: Audit, signal?: AbortSignal): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY;
  if (!key) throw new Error('no model key');
  const findings = a.items.slice(0, 8).map(({ rows, kind, ...f }) => ({ ...f, finding: kindLabel(kind), amount: (f.cents / 100).toFixed(2), per: f.per, rowCount: rows.length }));
  const res = await fetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Clawback coworker' },
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
  const ask: Record<string, string> = {
    recover: 'Please refund this charge.',
    duplicate: 'I was charged twice for one purchase. Please refund the second charge.',
    fee: 'Please waive these fees as a goodwill gesture.',
    price_increase: 'My price went up recently. Please return me to my previous rate or offer a loyalty discount.',
    cancel_or_keep: 'Please cancel this subscription and confirm that no further charges will be made.',
    negotiate: 'I am reviewing my plan. Please tell me about any cheaper plan or retention offer.',
  };
  const lines = ['## Messages to send'];
  for (const f of a.items.slice(0, 6)) lines.push('', `**${f.title}**`, `Hello, about the charges on my statement (${f.rows[0]?.date ?? ''} onward): ${ask[f.kind]} Account: [account email].`);
  return lines.join('\n');
}

/** Full Task result: sourced findings first, then drafted messages. The model never touches the numbers. */
export async function buildReport(input: string, opts: { today?: string; signal?: AbortSignal } = {}): Promise<{ text: string; actions: string; audit: Audit; model: string }> {
  const a = await audit(input, opts.today);
  const head = renderFindings(a);
  if (!a.ok || !a.items.length) return { text: head, actions: '', audit: a, model: 'none' };
  let actions: string;
  let model = MODEL;
  try {
    actions = await draft(a, opts.signal);
  } catch {
    actions = fallback(a);
    model = 'template';
  }
  const foot = '\n\n---\nClawback recovery audit. Figures are computed from the statement rows above; recurring charges are to review, not confirmed unused. Messages are drafts for you to review before sending.';
  return { text: `${head}\n\n${actions}${foot}`, actions, audit: a, model };
}
