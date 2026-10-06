import { findSchedules } from './recurring.js';
import type { EmailRecord, FindTransaction, Subscription } from './types.js';
import { daysBetween } from './util.js';

/**
 * Recurring charges from the statement, enriched from email: the plan (from receipts whose amount and
 * date match the charges) and the last usage signal (activity emails for that plan or merchant).
 */
export function buildSubscriptions(transactions: FindTransaction[], emails: EmailRecord[], opts: { latest?: string } = {}): Subscription[] {
  const schedules = findSchedules(
    transactions.map((t) => ({ id: t.id, date: t.date, amount: t.amount, payee: t.merchantKey })),
    opts,
  );
  const byId = new Map(transactions.map((t) => [t.id, t]));
  const perMerchant = new Map<string, number>();
  for (const s of schedules) perMerchant.set(s.payee, (perMerchant.get(s.payee) ?? 0) + 1);

  return schedules.map((s) => {
    const txns = s.transactionIds.map((id) => byId.get(id)!);
    const merchantEmails = emails.filter((e) => e.merchantKey === s.payee);
    // Receipts that line up with one of this schedule's charges (same amount, within 2 days).
    const receipts = merchantEmails
      .filter((e) => (e.kind === 'receipt' || e.kind === 'trial_converted') && e.fields.amount === s.amount)
      .filter((e) => txns.some((t) => Math.abs(daysBetween(t.date, e.date)) <= 2))
      .sort((a, b) => b.date.localeCompare(a.date));
    const planId = receipts.find((r) => r.fields.subscriptionId)?.fields.subscriptionId ?? null;
    const planName = receipts.find((r) => r.fields.plan)?.fields.plan ?? null;
    const usage = merchantEmails.filter((e) => {
      if (e.kind !== 'usage') return false;
      if (planId && e.fields.subscriptionId) return e.fields.subscriptionId === planId;
      if (planName && e.fields.plan) return e.fields.plan.toLowerCase() === planName.toLowerCase();
      return perMerchant.get(s.payee) === 1; // unattributed usage only counts when the merchant has one plan
    });
    const lastUse = usage.map((e) => e.fields.watchedOn ?? e.date).sort().at(-1) ?? null;
    return {
      id: s.id,
      merchant: txns[0]!.merchant,
      merchantKey: s.payee,
      amount: s.amount,
      currency: txns[0]!.currency,
      cadence: s.cadence,
      start: s.start,
      lastCharge: s.lastCharge,
      nextCharge: s.nextCharge,
      exactDate: s.exactDate,
      exactAmount: s.exactAmount,
      transactionIds: s.transactionIds,
      planName,
      planId,
      lastUseSignal: lastUse,
      usageEmailIds: usage.map((e) => e.id),
    };
  });
}
