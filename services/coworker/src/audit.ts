import { runFind } from '@overpaid/find';
import { VIGIL_LABEL, type Opportunity } from '@overpaid/shared';

export const USAGE = [
  'Paste a card or bank statement as CSV in the Task description, with a header row.',
  'Columns: Date, Description, Amount (Currency optional). At least three months works best.',
  'Example:',
  'Date,Description,Amount,Currency',
  '2026-04-03,FITPULSE CLUB MEMBERSHIP,59.00,USD',
].join('\n');

/** Pulls the CSV block out of free text: the first line with date and amount headers, then every row with a comma. */
export function extractCsv(text: string): string | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim().replace(/^```\w*$/, ''));
  const head = lines.findIndex((l) => /date/i.test(l) && /amount|debit/i.test(l) && l.includes(','));
  if (head < 0) return null;
  const rows = lines.slice(head + 1).filter((l) => l.includes(',') && /\d/.test(l));
  return rows.length ? [lines[head], ...rows].join('\n') : null;
}

export interface Finding {
  type: string;
  merchant: string;
  cents: number;
  currency: string;
  confidence: number;
  reason: string;
  rows: { date: string; descriptor: string; cents: number }[];
}

export interface Audit {
  ok: boolean;
  rows: number;
  months: number;
  findings: Finding[];
  totalCents: number;
  currency: string;
}

export async function audit(text: string, today = new Date().toISOString().slice(0, 10)): Promise<Audit> {
  const csv = extractCsv(text);
  if (!csv) return { ok: false, rows: 0, months: 0, findings: [], totalCents: 0, currency: 'USD' };
  const r = await runFind({ files: [{ name: 'statement.csv', bytes: Buffer.from(csv, 'utf8') }] }, { today });
  const tx = new Map(r.transactions.map((t) => [t.id, t]));
  const months = new Set(r.transactions.map((t) => t.date.slice(0, 7))).size;
  const findings = r.opportunities
    .sort((a: Opportunity, b: Opportunity) => b.valueEstimate - a.valueEstimate)
    .map((o) => ({
      type: VIGIL_LABEL[o.vigilType] ?? o.vigilType,
      merchant: o.merchant,
      cents: o.valueEstimate,
      currency: o.currency,
      confidence: o.confidence,
      reason: o.reason,
      rows: o.sourceRecordIds.flatMap((id) => {
        const t = tx.get(id);
        return t ? [{ date: t.date, descriptor: t.descriptor, cents: t.amount }] : [];
      }),
    }));
  return { ok: true, rows: r.transactions.length, months, findings, totalCents: r.total.amount, currency: r.total.currency };
}

const money = (cents: number, cur: string) => `${cur === 'USD' ? '$' : `${cur} `}${(cents / 100).toFixed(2)}`;

/** The deterministic part of the report. Every number here comes from the statement rows. */
export function renderFindings(a: Audit): string {
  if (!a.ok) return `I could not find a statement in this Task.\n\n${USAGE}`;
  const out = [
    `# Recovery audit`,
    ``,
    `Read ${a.rows} transactions over ${a.months} month${a.months === 1 ? '' : 's'}. Found ${a.findings.length} item${a.findings.length === 1 ? '' : 's'} worth ${money(a.totalCents, a.currency)} in total.`,
  ];
  if (!a.findings.length) out.push('', 'Nothing to recover in this statement: no unused recurring charges, duplicates or above-market bills.');
  a.findings.forEach((f, i) => {
    out.push('', `## ${i + 1}. ${f.merchant}: ${money(f.cents, f.currency)} (${f.type.toLowerCase()})`, '', f.reason, '', `Confidence ${Math.round(f.confidence * 100)}%. Source rows:`);
    for (const r of f.rows.slice(0, 8)) out.push(`- ${r.date}  ${r.descriptor}  ${money(r.cents, f.currency)}`);
    if (f.rows.length > 8) out.push(`- and ${f.rows.length - 8} more`);
  });
  return out.join('\n');
}
