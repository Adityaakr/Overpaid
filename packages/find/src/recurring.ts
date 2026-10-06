/*
 * Recurring-charge detection: a port of Actual Budget's `findSchedules()`.
 *
 *   Source:  https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/schedules/find-schedules.ts
 *            (+ getApproxNumberThreshold from packages/loot-core/src/shared/rules.ts)
 *   License: MIT, Copyright (c) James Long and Actual Budget contributors.
 *            https://github.com/actualbudget/actual/blob/master/LICENSE.txt
 *
 * What is kept from the original:
 *   - the search: from the latest transaction, try every candidate start date for each pattern (weekly,
 *     every two weeks, monthly on day X, monthly on the last day), take the first 3 occurrences of that
 *     schedule and look for a transaction within +-2 days of each one;
 *   - amount matching within getApproxNumberThreshold (7.5%), and the payee must match;
 *   - ranking: 1 / (daysOff + 1) per occurrence; exactDate when every occurrence hits its day exactly;
 *   - the winner per payee is the highest-ranked candidate; findStartDate then walks the schedule back
 *     while earlier occurrences still have a matching transaction.
 *
 * What is adapted:
 *   - pure and in-memory: takes an array of transactions instead of querying the AQL database, no async;
 *   - one account (a card statement); transfers and already-scheduled transactions don't exist here;
 *   - matching requires payee AND amount in the same `find` (the original finds by amount first and then
 *     rejects if the payee differs, which can miss a payee when another payee's amount is closer);
 *   - the winner is chosen per (payee, amount cluster) instead of per payee, so two plans at one merchant
 *     (e.g. two Vistaflix memberships) become two subscriptions;
 *   - the "monthly 1st/3rd" and "2nd/4th weekday" patterns are omitted (the original derives their weekday
 *     from `new Date()` rather than the start date, so they are not deterministic);
 *   - a density guard drops payees charged far more often than the cadence (a daily coffee shop that
 *     happens to line up weekly is not a subscription);
 *   - each result carries the ids of every transaction it matched, for "show your work".
 */
import type { Cadence } from './types.js';
import { addDays, addMonths, daysBetween, lastDayOfMonth, shortHash } from './util.js';

export interface RecurringInput {
  id: string;
  date: string; // ISO date
  amount: number; // cents, positive charges
  payee: string; // normalised merchant key
}

export interface RecurringSchedule {
  id: string;
  payee: string;
  amount: number;
  cadence: Cadence;
  interval: number;
  start: string;
  lastCharge: string;
  nextCharge: string;
  rank: number;
  exactDate: boolean;
  exactAmount: boolean;
  transactionIds: string[];
}

interface Config {
  frequency: 'weekly' | 'monthly';
  interval: number;
  start: string;
  lastDay?: boolean;
}

const WINDOW_DAYS = 2;
const TAKE = 3;

/** Actual: `Math.round(Math.abs(number) * 0.075)`. */
export const getApproxNumberThreshold = (n: number) => Math.round(Math.abs(n) * 0.075);

function nthOccurrence(config: Config, n: number): string {
  if (config.frequency === 'weekly') return addDays(config.start, 7 * config.interval * n);
  const d = addMonths(config.start, config.interval * n);
  return config.lastDay ? lastDayOfMonth(d) : d;
}
const takeDates = (config: Config, take = TAKE) => Array.from({ length: take }, (_, i) => nthOccurrence(config, i));
const getRank = (day1: string, day2: string) => 1 / (Math.abs(daysBetween(day1, day2)) + 1);

class Index {
  private byDate = new Map<string, RecurringInput[]>();
  constructor(txns: RecurringInput[]) {
    for (const t of txns) {
      const list = this.byDate.get(t.date) ?? [];
      list.push(t);
      this.byDate.set(t.date, list);
    }
  }
  /** Actual's getTransactions(date): everything within +-2 days. */
  around(date: string, days = WINDOW_DAYS): RecurringInput[] {
    const out: RecurringInput[] = [];
    for (let i = -days; i <= days; i++) out.push(...(this.byDate.get(addDays(date, i)) ?? []));
    return out;
  }
}

interface Candidate {
  rank: number;
  amount: number;
  payee: string;
  config: Config;
  exactDate: boolean;
  exactAmount: boolean;
}

function matchSchedules(allOccurs: { date: string; transactions: RecurringInput[] }[], config: Config): Candidate[] {
  const occursRev = [...allOccurs].reverse();
  const baseOccur = occursRev[0]!;
  const occurs = occursRev.slice(1);
  const out: Candidate[] = [];
  for (const trans of baseOccur.transactions) {
    const threshold = getApproxNumberThreshold(trans.amount);
    const found = occurs.map((occur) => {
      const matched = occur.transactions.find((t) => t.payee === trans.payee && t.amount >= trans.amount - threshold && t.amount <= trans.amount + threshold);
      return matched ? { trans: matched, rank: getRank(occur.date, matched.date) } : null;
    });
    if (found.includes(null)) continue;
    const hits = found as { trans: RecurringInput; rank: number }[];
    const rank = hits.reduce((total, m) => total + m.rank, getRank(baseOccur.date, trans.date));
    out.push({
      rank,
      amount: trans.amount,
      payee: trans.payee,
      config,
      exactDate: rank === allOccurs.length,
      exactAmount: hits.every((m) => m.trans.amount === trans.amount),
    });
  }
  return out;
}

function schedulesForPattern(index: Index, baseStart: string, numDays: number, baseConfig: (start: string) => Config | false): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < numDays; i++) {
    const config = baseConfig(addDays(baseStart, i));
    if (config === false) continue;
    const data = takeDates(config).map((date) => ({ date, transactions: index.around(date) }));
    out.push(...matchSchedules(data, config));
  }
  return out;
}

const weekly = (ix: Index, latest: string) => schedulesForPattern(ix, addDays(latest, -7 * 4), 7 * 2, (start) => ({ frequency: 'weekly', interval: 1, start }));
// 6 weeks would cover 3 instances, but we also scan an additional week back
const every2weeks = (ix: Index, latest: string) => schedulesForPattern(ix, addDays(latest, -7 * 7), 7 * 2, (start) => ({ frequency: 'weekly', interval: 2, start }));
const monthly = (ix: Index, latest: string) =>
  schedulesForPattern(ix, addMonths(latest, -4), 31 * 2, (start) =>
    // 28 is the max day all months are guaranteed to have; month ends are the monthlyLastDay pattern.
    Number(start.slice(8, 10)) > 28 ? false : { frequency: 'monthly', interval: 1, start },
  );
const monthlyLastDay = (ix: Index, latest: string) => [
  ...schedulesForPattern(ix, lastDayOfMonth(addMonths(latest, -3)), 1, (start) => ({ frequency: 'monthly', interval: 1, start, lastDay: true })),
  ...schedulesForPattern(ix, lastDayOfMonth(addMonths(latest, -4)), 1, (start) => ({ frequency: 'monthly', interval: 1, start, lastDay: true })),
];

const cadenceOf = (c: Config): Cadence => (c.frequency === 'weekly' ? (c.interval === 2 ? 'biweekly' : 'weekly') : c.lastDay ? 'monthly_last_day' : 'monthly');
const periodDays = (c: Config) => (c.frequency === 'weekly' ? 7 * c.interval : 30.44 * c.interval);

function matching(ix: Index, payee: string, amount: number, date: string): RecurringInput | undefined {
  const threshold = getApproxNumberThreshold(amount);
  return ix
    .around(date)
    .filter((t) => t.payee === payee && Math.abs(t.amount - amount) <= threshold)
    .sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)))[0];
}

/** Actual's findStartDate: walk back one period at a time while an earlier occurrence still matches. */
function findStartDate(ix: Index, c: Candidate, earliest: string): Config {
  let config = c.config;
  for (;;) {
    const prev: Config = { ...config, start: nthOccurrence(config, -1) };
    if (prev.start < addDays(earliest, -WINDOW_DAYS) || !matching(ix, c.payee, c.amount, prev.start)) return config;
    config = prev;
  }
}

/**
 * Find recurring charges in a list of transactions. Pure and deterministic.
 * `opts.latest` defaults to the latest transaction date (as in Actual).
 */
export function findSchedules(transactions: RecurringInput[], opts: { latest?: string } = {}): RecurringSchedule[] {
  const charges = transactions.filter((t) => t.amount > 0);
  if (!charges.length) return [];
  const sorted = [...charges].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const latest = opts.latest ?? sorted.at(-1)!.date;
  const earliest = sorted[0]!.date;
  const ix = new Index(sorted);

  const all = [...weekly(ix, latest), ...every2weeks(ix, latest), ...monthly(ix, latest), ...monthlyLastDay(ix, latest)];

  // Winner per (payee, amount cluster): sort by rank desc, then accept candidates whose amount is not
  // within the threshold of an already accepted winner for that payee.
  const byPayee = new Map<string, Candidate[]>();
  for (const c of all) byPayee.set(c.payee, [...(byPayee.get(c.payee) ?? []), c]);
  const winners: Candidate[] = [];
  for (const payee of [...byPayee.keys()].sort()) {
    // Stable sort, as in Actual: on equal rank the earlier pattern (weekly before every-2-weeks before monthly) wins.
    const list = byPayee.get(payee)!.sort((a, b) => b.rank - a.rank);
    const accepted: Candidate[] = [];
    for (const c of list) {
      if (accepted.some((w) => Math.abs(w.amount - c.amount) <= Math.max(getApproxNumberThreshold(w.amount), getApproxNumberThreshold(c.amount)))) continue;
      accepted.push(c);
    }
    winners.push(...accepted);
  }

  const built: (RecurringSchedule & { config: Config })[] = [];
  for (const w of winners) {
    const config = findStartDate(ix, w, earliest);
    // Collect every matched occurrence from the start up to the latest date.
    const used = new Set<string>();
    const ids: string[] = [];
    let lastCharge = config.start;
    let n = 0;
    for (let occ = nthOccurrence(config, 0); occ <= addDays(latest, WINDOW_DAYS); occ = nthOccurrence(config, ++n)) {
      const t = matching(ix, w.payee, w.amount, occ);
      if (t && !used.has(t.id)) {
        used.add(t.id);
        ids.push(t.id);
        lastCharge = t.date;
      }
    }
    if (ids.length < TAKE) continue;
    built.push({
      id: `sub_${shortHash(`${w.payee}|${w.amount}|${config.start}|${cadenceOf(config)}`)}`,
      payee: w.payee,
      amount: w.amount,
      cadence: cadenceOf(config),
      interval: config.interval,
      start: config.start,
      lastCharge,
      nextCharge: nthOccurrence(config, n),
      rank: w.rank,
      exactDate: w.exactDate,
      exactAmount: w.exactAmount,
      transactionIds: ids,
      config,
    });
  }

  // Density guard: a payee charged far more often than the cadence (once other schedules of the same
  // payee are accounted for) is everyday spending that happened to line up, not a subscription.
  const out: RecurringSchedule[] = [];
  for (const b of built) {
    const others = new Set(built.filter((o) => o !== b && o.payee === b.payee).flatMap((o) => o.transactionIds));
    const span = Math.max(daysBetween(b.start, latest), 1);
    const expected = span / periodDays(b.config) + 1;
    const charged = sorted.filter((t) => t.payee === b.payee && t.date >= addDays(b.start, -WINDOW_DAYS) && !others.has(t.id)).length;
    if (charged > 1.5 * expected) continue;
    const { config: _config, ...schedule } = b;
    out.push(schedule);
  }
  return out.sort((a, b) => a.payee.localeCompare(b.payee) || a.amount - b.amount);
}
