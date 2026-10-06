import { describe, expect, it } from 'vitest';
import { findSchedules, getApproxNumberThreshold, type RecurringInput } from '../src/recurring.js';
import { addDays, addMonths } from '../src/util.js';

let n = 0;
const t = (date: string, payee: string, amount: number): RecurringInput => ({ id: `r${++n}`, date, payee, amount });
const monthly = (start: string, count: number, payee: string, amount: number, jitter: number[] = []) =>
  Array.from({ length: count }, (_, i) => t(addDays(addMonths(start, i), jitter[i] ?? 0), payee, amount));

describe('findSchedules (ported from Actual Budget)', () => {
  it('uses Actual\'s 7.5% amount threshold', () => {
    expect(getApproxNumberThreshold(2299)).toBe(172);
    expect(getApproxNumberThreshold(-1000)).toBe(75);
  });
  it('finds a monthly charge, walks back to its first occurrence and predicts the next', () => {
    const [s] = findSchedules(monthly('2026-04-12', 6, 'tunewave', 1099));
    expect(s).toMatchObject({ payee: 'tunewave', cadence: 'monthly', start: '2026-04-12', lastCharge: '2026-09-12', nextCharge: '2026-10-12', exactDate: true, exactAmount: true });
    expect(s!.transactionIds).toHaveLength(6);
  });
  it('tolerates +-2 days and small amount drift (isapprox)', () => {
    const txns = monthly('2026-04-05', 5, 'gym', 5900, [0, 1, -2, 2, 0]).map((x, i) => ({ ...x, amount: x.amount + (i % 2 ? 150 : 0) }));
    const [s] = findSchedules(txns);
    expect(s).toMatchObject({ cadence: 'monthly', exactAmount: false });
    expect(s!.transactionIds).toHaveLength(5);
  });
  it('splits two plans at the same merchant into two schedules', () => {
    const out = findSchedules([...monthly('2026-05-02', 6, 'vistaflix', 2299), ...monthly('2026-04-18', 6, 'vistaflix', 699)]);
    expect(out.map((s) => [s.payee, s.amount, s.start])).toEqual([
      ['vistaflix', 699, '2026-04-18'],
      ['vistaflix', 2299, '2026-05-02'],
    ]);
  });
  it('finds weekly and every-two-weeks cadences', () => {
    const weekly = Array.from({ length: 8 }, (_, i) => t(addDays('2026-08-03', 7 * i), 'veg-box', 3500));
    const fortnightly = Array.from({ length: 6 }, (_, i) => t(addDays('2026-07-06', 14 * i), 'cleaner', 8000));
    const out = findSchedules([...weekly, ...fortnightly]);
    expect(out.find((s) => s.payee === 'veg-box')?.cadence).toBe('weekly');
    expect(out.find((s) => s.payee === 'cleaner')?.cadence).toBe('biweekly');
  });
  it('ignores one-offs, two-offs and dense everyday spending', () => {
    const coffee = Array.from({ length: 120 }, (_, i) => t(addDays('2026-06-01', i), 'coffee', 600 + (i % 3) * 20));
    const out = findSchedules([t('2026-09-01', 'shop', 4999), ...monthly('2026-08-10', 2, 'twice', 1000), ...coffee]);
    expect(out).toEqual([]);
  });
});
