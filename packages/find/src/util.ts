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
/** Parses "16 September 2026", "Sep 16, 2026", "2026-09-16", "16/09/2026" (day first). Returns ISO date or null. */
export function parseLooseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const mon = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const fmt = (y: string, mo: number, d: string) => (mo > 0 ? `${y}-${String(mo).padStart(2, '0')}-${d.padStart(2, '0')}` : null);
  m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) return fmt(m[3]!, mon(m[2]!), m[1]!);
  m = t.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) return fmt(m[3]!, mon(m[1]!), m[2]!);
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return fmt(m[3]!, Number(m[2]), m[1]!);
  return null;
}

/** Parses "$1,234.56", "-29.90", "(12.30)", "USD 5.00" into integer cents. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[\s,]/g, '');
  const m = t.match(/(\(|-)?[A-Z$€£S]*\$?(\d+(?:\.\d{1,2})?)\)?/);
  if (!m) return null;
  const v = Math.round(Number(m[2]) * 100);
  return m[1] ? -v : v;
}
