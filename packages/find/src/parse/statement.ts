import { parse } from 'csv-parse/sync';
import { normaliseDescriptor } from '../normalise.js';
import type { FindTransaction } from '../types.js';
import { detectDateOrder, parseLooseDate, parseMoney, shortHash } from '../util.js';

export interface StatementRow {
  date: string;
  descriptor: string;
  amount: number; // cents; > 0 charge, < 0 credit
  currency: string;
  card: string | null;
}

// Header names seen in real bank and card exports (lowercased, punctuation stripped).
const HEADER_ALIASES: Record<keyof StatementRow | 'debit' | 'credit', string[]> = {
  date: ['date', 'transaction date', 'trans date', 'posted date', 'posting date', 'post date', 'booking date', 'value date', 'completed date', 'started date', 'date posted', 'txn date'],
  descriptor: ['description', 'descriptor', 'merchant', 'merchant name', 'details', 'transaction details', 'transaction description', 'narrative', 'payee', 'name', 'memo', 'reference', 'particulars', 'counterparty', 'beneficiary', 'original description'],
  amount: ['amount', 'value', 'transaction amount', 'amount usd', 'amount eur', 'amount gbp', 'amount sgd', 'amount inr', 'amount aud', 'amount cad', 'net amount', 'billing amount'],
  debit: ['debit', 'debits', 'debit amount', 'withdrawal', 'withdrawals', 'withdrawal amount', 'money out', 'paid out', 'out', 'spent'],
  credit: ['credit', 'credits', 'credit amount', 'deposit', 'deposits', 'deposit amount', 'money in', 'paid in', 'in', 'received'],
  currency: ['currency', 'ccy', 'currency code'],
  card: ['card', 'card last4', 'card number', 'last4', 'card no', 'account', 'account number'],
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[()\[\]:.]/g, ' ').replace(/\s+/g, ' ').trim();

function findColumn(headers: string[], field: keyof typeof HEADER_ALIASES): number {
  const norm = headers.map(normHeader);
  const exact = norm.findIndex((h) => HEADER_ALIASES[field].includes(h));
  if (exact >= 0 || field === 'currency' || field === 'card') return exact;
  // Loose fallback: "Amount (SGD)", "Description 1", "Debit (USD)".
  return norm.findIndex((h) => HEADER_ALIASES[field].some((a) => a.length > 3 && h.startsWith(a)));
}

/** Map a table (first row = header) to statement rows. Shared by the CSV and PDF paths. */
export function rowsFromTable(table: string[][], defaultCurrency = 'USD'): { rows: StatementRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const headerIdx = table.findIndex((r) => findColumn(r, 'date') >= 0 && findColumn(r, 'descriptor') >= 0);
  if (headerIdx < 0) return { rows: [], warnings: ['no header row with date and description columns'] };
  const header = table[headerIdx]!;
  const col = (f: keyof typeof HEADER_ALIASES) => findColumn(header, f);
  const [cDate, cDesc, cAmt, cDebit, cCredit, cCur, cCard] = [col('date'), col('descriptor'), col('amount'), col('debit'), col('credit'), col('currency'), col('card')];
  const rows: StatementRow[] = [];
  const body = table.slice(headerIdx + 1);
  const order = detectDateOrder(body.map((r) => r[cDate] ?? ''));
  body.forEach((r, i) => {
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const date = parseLooseDate(cell(cDate), order);
    const descriptor = cell(cDesc).replace(/\s+/g, ' ');
    let amount: number | null = null;
    if (cAmt >= 0) amount = parseMoney(cell(cAmt));
    else if (cDebit >= 0 || cCredit >= 0) {
      const d = parseMoney(cell(cDebit));
      const c = parseMoney(cell(cCredit));
      amount = d ? Math.abs(d) : c ? -Math.abs(c) : null;
    }
    if (!date || !descriptor || amount === null) {
      if (r.some((x) => x.trim())) warnings.push(`row ${headerIdx + i + 2}: unreadable, skipped`);
      return;
    }
    const card = cell(cCard).replace(/\D/g, '').slice(-4) || null;
    rows.push({ date, descriptor, amount, currency: (cell(cCur) || defaultCurrency).toUpperCase(), card });
  });
  // Bank exports usually write money out as negative; card statements write charges as positive.
  // With a single amount column, the sign most rows carry is the spending sign.
  if (cAmt >= 0) {
    const neg = rows.filter((r) => r.amount < 0).length;
    if (neg > rows.length - neg) {
      for (const r of rows) r.amount = -r.amount;
      warnings.push('money out is negative in this export; read it as charges');
    }
  }
  return { rows, warnings };
}

/** The delimiter that splits the header-looking lines most consistently: comma, semicolon, tab or pipe. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0]!;
    const score = counts.filter((n) => n === mode).length * 10 + mode;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

export function parseStatementCsv(text: string, defaultCurrency = 'USD'): { rows: StatementRow[]; warnings: string[] } {
  const table = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true, delimiter: sniffDelimiter(text) }) as string[][];
  return rowsFromTable(table, defaultCurrency);
}

const ORDER_REF = /\b([A-Z]{1,4}-\d{3,8})\b/;
const BOOKING_REF = /\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6}\b/;
/** An order or booking reference embedded in a descriptor, e.g. "CARTWELL.COM ORDER CW-4417". */
export function refFromDescriptor(descriptor: string): string | null {
  const up = descriptor.toUpperCase();
  const tail = up.replace(/^\S+\s*/, ''); // never take the merchant stem itself
  return tail.match(ORDER_REF)?.[1] ?? tail.match(BOOKING_REF)?.[0] ?? null;
}

export function toTransactions(rows: StatementRow[], sourceId: string): FindTransaction[] {
  return rows.map((r, i) => {
    const who = normaliseDescriptor(r.descriptor);
    return {
      id: `txn_${shortHash(`${sourceId}|${i}|${r.date}|${r.descriptor}|${r.amount}`)}`,
      sourceId,
      merchant: who.merchant,
      merchantKey: who.merchantKey,
      descriptor: r.descriptor,
      amount: r.amount,
      currency: r.currency,
      date: r.date,
      orderId: refFromDescriptor(r.descriptor),
      card: r.card,
      normalisedBy: who.rule,
    };
  });
}
