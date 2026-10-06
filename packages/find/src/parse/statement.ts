import { parse } from 'csv-parse/sync';
import { normaliseDescriptor } from '../normalise.js';
import type { FindTransaction } from '../types.js';
import { parseLooseDate, parseMoney, shortHash } from '../util.js';

export interface StatementRow {
  date: string;
  descriptor: string;
  amount: number; // cents; > 0 charge, < 0 credit
  currency: string;
  card: string | null;
}

const HEADER_ALIASES: Record<keyof StatementRow | 'debit' | 'credit', string[]> = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'trans date'],
  descriptor: ['description', 'descriptor', 'merchant', 'details', 'narrative', 'payee'],
  amount: ['amount', 'value', 'amount (usd)'],
  debit: ['debit', 'withdrawal', 'money out'],
  credit: ['credit', 'deposit', 'money in'],
  currency: ['currency', 'ccy'],
  card: ['card', 'card last4', 'card number', 'last4', 'card no'],
};

function findColumn(headers: string[], field: keyof typeof HEADER_ALIASES): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  return norm.findIndex((h) => HEADER_ALIASES[field].includes(h));
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
  table.slice(headerIdx + 1).forEach((r, i) => {
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const date = parseLooseDate(cell(cDate));
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
  return { rows, warnings };
}

export function parseStatementCsv(text: string, defaultCurrency = 'USD'): { rows: StatementRow[]; warnings: string[] } {
  const table = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
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
