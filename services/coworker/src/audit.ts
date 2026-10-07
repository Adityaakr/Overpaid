import { runFind, type FindResult, type FindTransaction, type Subscription } from '@overpaid/find';
import { VIGIL_LABEL } from '@overpaid/shared';

export const USAGE = [
  'Paste or upload a bank or card statement as CSV, with a header row.',
  'It needs a date, a description and an amount (or debit and credit columns). Three months or more works best.',
  'Example:',
  'Date,Description,Amount',
  '2026-07-06,Cloud hosting subscription,-49.00',
].join('\n');

export type ItemKind = 'recover' | 'duplicate' | 'fee' | 'price_increase' | 'cancel_or_keep' | 'negotiate';
export interface Row {
  id: string;
  date: string;
  descriptor: string;
  cents: number;
}
export interface Item {
  kind: ItemKind;
  title: string;
  category: string;
  /** Money at stake: a refund for recover/duplicate/fee, a yearly cost for recurring items. */
  cents: number;
  per: 'once' | 'year';
  monthlyCents: number | null;
  confidence: 'high' | 'medium' | 'low';
  why: string;
  action: string;
  rows: Row[];
}
export interface Audit {
  ok: boolean;
  currency: string;
  rows: number;
  months: number;
  from: string | null;
  to: string | null;
  moneyInCents: number;
  moneyOutCents: number;
  avgMonthlyOutCents: number;
  recurringMonthlyCents: number;
  claimCents: number;
  reviewYearCents: number;
  items: Item[];
  fixed: { title: string; category: string; monthlyCents: number }[];
  warnings: string[];
  /** Back-compat for callers that only want one figure and a list. */
  totalCents: number;
  findings: Item[];
}

// Category rules, checked in order against "merchant descriptor" (lowercase).
const CATEGORIES: { name: string; kind: 'fixed' | 'bill' | 'subscription'; re: RegExp }[] = [
  { name: 'Housing', kind: 'fixed', re: /\b(rent|mortgage|lease|landlord|strata|hoa|property mgmt)\b/ },
  { name: 'Loan or credit', kind: 'fixed', re: /\b(loan|repayment|credit card payment|card payment|emi|instal?ment|financing|student aid)\b/ },
  { name: 'Transfer or savings', kind: 'fixed', re: /\b(transfer|savings|investment|brokerage|deposit to|to savings|zelle|venmo|paypal transfer)\b/ },
  { name: 'Tax', kind: 'fixed', re: /\b(tax|irs|hmrc|iras|council tax)\b/ },
  { name: 'Insurance', kind: 'bill', re: /\b(insurance|insurer|premium|geico|allstate|aviva|axa|prudential|aia)\b/ },
  { name: 'Mobile and internet', kind: 'bill', re: /\b(mobile|phone|cellular|wireless|internet|broadband|fiber|fibre|wifi|telecom|verizon|at&t|t-mobile|tmobile|comcast|xfinity|spectrum|vodafone|singtel|starhub|m1|airtel|jio|optus|telstra|ee|o2|three)\b/ },
  { name: 'Utilities', kind: 'bill', re: /\b(electric|electricity|power|energy|gas bill|water|utility|utilities|sewer|pg&e|con ed|sp services|octopus)\b/ },
  { name: 'Software and cloud', kind: 'subscription', re: /\b(software|saas|cloud|hosting|server|aws|amazon web|gcp|google cloud|azure|vercel|netlify|heroku|digitalocean|github|gitlab|notion|slack|figma|adobe|microsoft|office 365|google workspace|g suite|dropbox|zoom|openai|chatgpt|anthropic|claude|cursor|jetbrains|atlassian|jira|canva|linear|1password|lastpass|domain|godaddy|namecheap)\b/ },
  { name: 'Streaming and media', kind: 'subscription', re: /\b(netflix|spotify|disney|hulu|hbo|max|paramount|peacock|youtube|apple tv|apple music|prime video|audible|kindle|deezer|tidal|crunchyroll|news|times|journal|magazine|patreon|substack)\b/ },
  { name: 'Fitness and memberships', kind: 'subscription', re: /\b(gym|fitness|club|membership|yoga|pilates|peloton|classpass|strava|costco|sam'?s club)\b/ },
  { name: 'Subscription', kind: 'subscription', re: /\b(subscription|subscr|monthly|membership|plan|premium|plus|pro)\b/ },
];
const FEE_RE = /\b(fee|fees|overdraft|od charge|late charge|late payment|service charge|maintenance charge|account charge|foreign transaction|fx fee|atm fee|interest charge|finance charge|penalty|returned item|nsf)\b/i;

const monthlyOf = (s: Subscription, amounts: number[]) => {
  const avg = s.exactAmount ? s.amount : Math.round(amounts.reduce((a, b) => a + b, 0) / Math.max(1, amounts.length));
  return s.cadence === 'weekly' ? Math.round((avg * 52) / 12) : s.cadence === 'biweekly' ? Math.round((avg * 26) / 12) : avg;
};
const money = (cents: number, cur = 'USD') => `${cur === 'USD' ? '$' : `${cur} `}${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rowOf = (t: FindTransaction): Row => ({ id: t.id, date: t.date, descriptor: t.descriptor, cents: t.amount });
const categorize = (text: string) => CATEGORIES.find((c) => c.re.test(text.toLowerCase())) ?? { name: 'Other recurring', kind: 'subscription' as const };

/** Pulls the table out of free text: from the first header-looking line (date + amount/debit) onward. */
export function extractCsv(text: string): string | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/^```\w*$/, ''));
  const head = lines.findIndex((l) => /date|datum|fecha/i.test(l) && /amount|debit|credit|withdraw|deposit|paid|value|betrag|importe/i.test(l) && /[,;\t|]/.test(l));
  if (head < 0) return null;
  const rows = lines.slice(head + 1).filter((l) => /[,;\t|]/.test(l) && /\d/.test(l));
  return rows.length ? [lines[head], ...rows].join('\n') : null;
}

const EMPTY = (warnings: string[] = []): Audit => ({
  ok: false, currency: 'USD', rows: 0, months: 0, from: null, to: null, moneyInCents: 0, moneyOutCents: 0, avgMonthlyOutCents: 0,
  recurringMonthlyCents: 0, claimCents: 0, reviewYearCents: 0, items: [], fixed: [], warnings, totalCents: 0, findings: [],
});

export async function audit(text: string, today = new Date().toISOString().slice(0, 10)): Promise<Audit> {
  const csv = extractCsv(text);
  if (!csv) return EMPTY(['No table with a date and an amount column was found.']);
  return auditFind(await runFind({ files: [{ name: 'statement.csv', bytes: Buffer.from(csv, 'utf8') }] }, { today }));
}

/** The audit over an existing Find result (statement transactions only), so callers can reuse its record ids. */
export function auditFind(r: FindResult): Audit {
  const txs = r.transactions;
  if (!txs.length) return EMPTY(r.sources.flatMap((s) => s.warnings).slice(0, 3));
  const currency = txs[0]!.currency;
  const byId = new Map(txs.map((t) => [t.id, t]));
  const dates = txs.map((t) => t.date).sort();
  const months = new Set(dates.map((d) => d.slice(0, 7))).size;
  const out = txs.filter((t) => t.amount > 0);
  const moneyOutCents = out.reduce((a, t) => a + t.amount, 0);
  const moneyInCents = -txs.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);

  const items: Item[] = [];
  const fixed: Audit['fixed'] = [];
  const covered = new Set<string>(); // transaction ids already explained by an item

  // 1. What the detectors can prove (forgotten subscriptions with no usage, duplicates against receipts, ...).
  for (const o of r.opportunities) {
    const rows = o.sourceRecordIds.flatMap((id) => (byId.get(id) ? [rowOf(byId.get(id)!)] : []));
    o.sourceRecordIds.forEach((id) => covered.add(id));
    // Forgotten subscriptions and above-market bills are valued per year; the rest are one-off refunds.
    const yearly = o.vigilType === 'forgotten_subscription' || o.vigilType === 'bill_above_market';
    items.push({
      kind: 'recover', title: o.merchant, category: VIGIL_LABEL[o.vigilType] ?? o.vigilType, cents: o.valueEstimate, per: yearly ? 'year' : 'once', monthlyCents: null,
      confidence: o.confidence >= 0.85 ? 'high' : o.confidence >= 0.6 ? 'medium' : 'low', why: o.reason,
      action: o.vigilType === 'forgotten_subscription' ? 'Cancel it, and ask for a refund of the recent unused charges.'
        : o.vigilType === 'bill_above_market' ? 'Ask for the market price, switch, or join a group deal.'
        : 'Ask the merchant for the refund.',
      rows,
    });
  }

  // 2. Every recurring charge: priced per year, categorised, with what to do about it.
  let recurringMonthlyCents = 0;
  // The recurring detector wants a stable amount; a monthly charge whose price changed is exactly the one worth
  // seeing, so add merchants charged in 3+ months at roughly monthly gaps with amounts within 40% of each other.
  const subs: Subscription[] = r.subscriptions.filter((s) => s.amount > 0);
  const inSubs = new Set(subs.flatMap((s) => s.transactionIds));
  const byMerchant = new Map<string, FindTransaction[]>();
  for (const t of out) if (!inSubs.has(t.id)) byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
  for (const [merchant, list] of byMerchant) {
    const ts = list.sort((a, b) => a.date.localeCompare(b.date));
    const monthsSeen = new Set(ts.map((t) => t.date.slice(0, 7)));
    if (ts.length < 3 || monthsSeen.size !== ts.length) continue;
    const gaps = ts.slice(1).map((t, i) => (Date.parse(t.date) - Date.parse(ts[i]!.date)) / 86_400_000);
    const amounts = ts.map((t) => t.amount);
    const lo = Math.min(...amounts), hi = Math.max(...amounts);
    if (!gaps.every((g) => g >= 25 && g <= 36) || hi > lo * 1.4) continue;
    // Eating out once a month is not a subscription: varying amounts must look like a subscription or a bill.
    if (lo !== hi && !CATEGORIES.some((c) => c.kind !== 'fixed' && c.name !== 'Subscription' && c.re.test(`${merchant} ${ts[0]!.descriptor}`.toLowerCase()))) continue;
    subs.push({
      id: `sub_${ts[0]!.id}`, merchant, merchantKey: merchant.toLowerCase(), amount: ts.at(-1)!.amount, currency, cadence: 'monthly',
      start: ts[0]!.date, lastCharge: ts.at(-1)!.date, nextCharge: '', exactDate: false, exactAmount: lo === hi,
      transactionIds: ts.map((t) => t.id), planName: null, planId: null, lastUseSignal: null, usageEmailIds: [],
    });
  }
  for (const s of subs) {
    const stx = s.transactionIds.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])).sort((a, b) => a.date.localeCompare(b.date));
    const monthly = monthlyOf(s, stx.map((t) => t.amount));
    recurringMonthlyCents += monthly;
    const cat = categorize(`${s.merchant} ${stx[0]?.descriptor ?? ''}`);
    if (cat.kind === 'fixed') {
      fixed.push({ title: s.merchant, category: cat.name, monthlyCents: monthly });
      stx.forEach((t) => covered.add(t.id));
      continue;
    }
    if (stx.some((t) => covered.has(t.id))) continue;
    stx.forEach((t) => covered.add(t.id));
    const rows = stx.map(rowOf);
    const cadence = s.cadence === 'weekly' ? 'every week' : s.cadence === 'biweekly' ? 'every two weeks' : 'every month';
    const first = stx[0]?.amount ?? 0, last = stx.at(-1)?.amount ?? 0;
    if (cat.name !== 'Utilities' && stx.length >= 2 && last > first * 1.02 && last - first >= 100) {
      items.push({
        kind: 'price_increase', title: s.merchant, category: cat.name, cents: (last - first) * 12, per: 'year', monthlyCents: last,
        confidence: 'high', why: `Went from ${money(first, currency)} to ${money(last, currency)} (+${Math.round(((last - first) / first) * 100)}%) between ${stx[0]!.date} and ${stx.at(-1)!.date}.`,
        action: 'Ask for the old price back or a loyalty discount; otherwise compare alternatives.', rows,
      });
    }
    const bill = cat.kind === 'bill';
    items.push({
      kind: bill ? 'negotiate' : 'cancel_or_keep', title: s.merchant, category: cat.name, cents: monthly * 12, per: 'year', monthlyCents: monthly,
      confidence: s.exactAmount && stx.length >= 3 ? 'high' : 'medium',
      why: `${s.exactAmount ? money(monthly, currency) : `About ${money(monthly, currency)}`} ${cadence}, ${stx.length} charges from ${stx[0]!.date} to ${stx.at(-1)!.date}${s.exactAmount ? '' : ' (amount varies)'}.`,
      action: bill
        ? `Compare current ${cat.name.toLowerCase()} plans or ask the provider for a retention offer; a lower plan saves part of ${money(monthly * 12, currency)} a year.`
        : `Check that someone still uses it. If not, cancel it and save ${money(monthly * 12, currency)} a year.`,
      rows,
    });
  }

  // 3. Same charge twice within three days (not part of a recurring series). Skip merchants paid often
  // (transit, coffee, groceries), where repeats are normal.
  const seen = new Map<string, FindTransaction>();
  const freq = new Map<string, number>();
  for (const t of out) freq.set(t.merchant, (freq.get(t.merchant) ?? 0) + 1);
  for (const t of [...out].sort((a, b) => a.date.localeCompare(b.date))) {
    if (covered.has(t.id) || t.amount < 500) continue;
    const key = `${t.descriptor.toLowerCase()}|${t.amount}`;
    const prev = seen.get(key);
    const gapDays = prev ? Math.abs(Date.parse(t.date) - Date.parse(prev.date)) / 86_400_000 : Infinity;
    // Same day: always suspicious. Within three days: only for merchants not paid often.
    if (prev && (gapDays === 0 || (gapDays <= 3 && (freq.get(t.merchant) ?? 0) <= 4))) {
      covered.add(t.id);
      items.push({
        kind: 'duplicate', title: t.merchant, category: 'Possible duplicate', cents: t.amount, per: 'once', monthlyCents: null, confidence: 'medium',
        why: `Charged ${money(t.amount, currency)} on ${prev.date} and again on ${t.date} with the same description.`,
        action: 'If you only bought once, ask the merchant (or your bank) to refund the second charge.', rows: [rowOf(prev), rowOf(t)],
      });
    } else seen.set(key, t);
  }

  // 4. Bank and card fees, which are often waived on request.
  const fees = out.filter((t) => !covered.has(t.id) && FEE_RE.test(t.descriptor));
  if (fees.length) {
    items.push({
      kind: 'fee', title: 'Bank and card fees', category: 'Fees', cents: fees.reduce((a, t) => a + t.amount, 0), per: 'once', monthlyCents: null, confidence: 'high',
      why: `${fees.length} fee${fees.length === 1 ? '' : 's'} on this statement.`,
      action: 'Ask the bank to waive them; first-time and goodwill refunds are common. Then turn on alerts or a fee-free plan.', rows: fees.map(rowOf),
    });
  }

  const order: Record<ItemKind, number> = { recover: 0, duplicate: 1, fee: 2, price_increase: 3, cancel_or_keep: 4, negotiate: 5 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.cents - a.cents);
  const claimCents = items.filter((i) => i.per === 'once').reduce((a, i) => a + i.cents, 0);
  const reviewYearCents = items.filter((i) => i.per === 'year' && i.kind !== 'price_increase').reduce((a, i) => a + i.cents, 0);
  return {
    ok: true, currency, rows: txs.length, months, from: dates[0] ?? null, to: dates.at(-1) ?? null, moneyInCents, moneyOutCents,
    avgMonthlyOutCents: Math.round(moneyOutCents / Math.max(1, months)), recurringMonthlyCents, claimCents, reviewYearCents, items,
    fixed: fixed.sort((a, b) => b.monthlyCents - a.monthlyCents), warnings: r.sources.flatMap((s) => s.warnings).slice(0, 3),
    totalCents: claimCents + reviewYearCents, findings: items,
  };
}

const KIND_LABEL: Record<ItemKind, string> = {
  recover: 'Money to claim back',
  duplicate: 'Possible duplicate charge',
  fee: 'Fees to dispute',
  price_increase: 'Price went up',
  cancel_or_keep: 'Subscription to review',
  negotiate: 'Bill to renegotiate',
};
export const kindLabel = (k: ItemKind) => KIND_LABEL[k];

/** The deterministic part of the report. Every number here comes from the statement rows. */
export function renderFindings(a: Audit): string {
  if (!a.ok) return `I could not read a statement in this Task. ${a.warnings[0] ?? ''}\n\n${USAGE}`;
  const c = a.currency;
  const out = [
    '# Recovery audit',
    '',
    `${a.rows} transactions from ${a.from} to ${a.to} (${a.months} month${a.months === 1 ? '' : 's'}). Money out ${money(a.moneyOutCents, c)}, about ${money(a.avgMonthlyOutCents, c)} a month. Recurring charges: ${money(a.recurringMonthlyCents, c)} a month.`,
    '',
    `**To claim back now:** ${money(a.claimCents, c)}. **Recurring spend to cut or review:** ${money(a.reviewYearCents, c)} a year.`,
  ];
  if (!a.items.length) out.push('', 'No duplicates, fees or reviewable recurring charges in this statement.');
  a.items.forEach((f, i) => {
    out.push('', `## ${i + 1}. ${f.title}: ${money(f.cents, c)}${f.per === 'year' ? ' a year' : ''} (${KIND_LABEL[f.kind].toLowerCase()})`, '', f.why, '', `What to do: ${f.action}`, '', `Category: ${f.category}. Confidence: ${f.confidence}. Source rows:`);
    for (const r of f.rows.slice(0, 6)) out.push(`- ${r.date}  ${r.descriptor}  ${money(r.cents, c)}`);
    if (f.rows.length > 6) out.push(`- and ${f.rows.length - 6} more`);
  });
  if (a.fixed.length) out.push('', `Fixed costs left out of the actions: ${a.fixed.map((f) => `${f.title} ${money(f.monthlyCents, c)}/month`).join(', ')}.`);
  return out.join('\n');
}
