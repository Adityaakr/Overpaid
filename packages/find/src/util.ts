import { createHash } from 'node:crypto';

const DAY = 86_400_000;
export const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(toMs(iso) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
export function addMonths(iso: string, n: number): string {
  const d = new Date(toMs(iso));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoOf(d.getTime());
}
export const lastDayOfMonth = (iso: string) => {
  const d = new Date(toMs(iso));
  return isoOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
};

export const shortHash = (s: string, n = 12) => createHash('sha256').update(s).digest('hex').slice(0, n);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** ISO date of an instant in a given IANA time zone. */
export function dateInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export type DateOrder = 'dmy' | 'mdy';
const year4 = (y: string) => (y.length === 2 ? `20${y}` : y);
/**
 * Parses "16 September 2026", "Sep 16, 2026", "2026-09-16", "2026/09/16", and numeric day/month dates with
 * `/`, `.` or `-` separators and 2- or 4-digit years. Numeric dates are day first unless `order` is 'mdy'.
 */
export function parseLooseDate(s: string, order: DateOrder = 'dmy'): string | null {
  const t = s.trim();
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  const mon = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const fmt = (y: string, mo: number, d: string) => (mo > 0 && mo <= 12 && Number(d) >= 1 && Number(d) <= 31 ? `${year4(y)}-${String(mo).padStart(2, '0')}-${d.padStart(2, '0')}` : null);
  m = t.match(/(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})/);
  if (m) return fmt(m[3]!, mon(m[2]!), m[1]!);
  m = t.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) return fmt(m[3]!, mon(m[1]!), m[2]!);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) return order === 'mdy' ? fmt(m[3]!, Number(m[1]), m[2]!) : fmt(m[3]!, Number(m[2]), m[1]!);
  return null;
}

/** Day/month order for a column of numeric dates: whichever position ever exceeds 12 is the day. */
export function detectDateOrder(cells: string[]): DateOrder {
  for (const c of cells) {
    const m = c.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) return 'dmy';
    if (Number(m[2]) > 12) return 'mdy';
  }
  return 'dmy';
}

/**
 * Parses "$1,234.56", "-29.90", "(12.30)", "USD 5.00", "1.234,56", "12,50", "12.00-", "45.00 CR" into integer cents.
 * CR marks a credit (negative), DR a debit.
 */
export function parseMoney(s: string): number | null {
  let t = s.trim();
  if (!t) return null;
  const credit = /\bCR\b/i.test(t);
  t = t.replace(/\b(CR|DR)\b/gi, '').replace(/[^\d.,()\-+]/g, '');
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-') || t.endsWith('-');
  t = t.replace(/[()\-+]/g, '');
  // Decimal separator: the last of '.' or ',' when followed by 1-2 digits; the other is a thousands separator.
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  const decAt = Math.max(lastDot, lastComma);
  let num: string;
  if (decAt >= 0 && t.length - decAt - 1 >= 1 && t.length - decAt - 1 <= 2) num = t.slice(0, decAt).replace(/[.,]/g, '') + '.' + t.slice(decAt + 1);
  else num = t.replace(/[.,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(num)) return null;
  const v = Math.round(Number(num) * 100);
  return neg || credit ? -v : v;
}
