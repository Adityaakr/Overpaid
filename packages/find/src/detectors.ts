// Vigil detectors. Each is a pure function of the parsed world -> opportunities, with a value, a
// confidence, a plain-language reason, the source records it came from, and meta refs the Fix fleet
// uses to pick a recipe (planId / orderId / bookingRef, always mirrored in meta.ref).
import { formatMoney, Opportunity, type VigilType } from '@overpaid/shared';
import type { MerchantPolicy, PolicyLibrary } from './policies.js';
import type { Catalog, EmailRecord, FindTransaction, Subscription } from './types.js';
import { addDays, daysBetween, shortHash } from './util.js';

export interface DetectorContext {
  today: string;
  transactions: FindTransaction[];
  emails: EmailRecord[];
  subscriptions: Subscription[];
  catalogs: Catalog[];
  policies: PolicyLibrary;
}
export type Detector = (ctx: DetectorContext) => Opportunity[];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const humanDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const fmt = (cents: number, currency: string) => formatMoney(cents, currency);
const PERIODS_PER_YEAR: Record<Subscription['cadence'], number> = { weekly: 52, biweekly: 26, monthly: 12, monthly_last_day: 12 };
const PERIOD_DAYS: Record<Subscription['cadence'], number> = { weekly: 7, biweekly: 14, monthly: 31, monthly_last_day: 31 };
const CADENCE_WORD: Record<Subscription['cadence'], string> = { weekly: 'every week', biweekly: 'every two weeks', monthly: 'every month', monthly_last_day: 'every month' };

function opportunity(o: {
  vigilType: VigilType;
  merchant: string;
  merchantKey: string;
  ref: string;
  valueEstimate: number;
  currency: string;
  confidence: number;
  reason: string;
  sourceRecordIds: string[];
  meta?: Record<string, unknown>;
}): Opportunity {
  return Opportunity.parse({
    id: `opp_${shortHash(`${o.vigilType}|${o.merchantKey}|${o.ref}`)}`,
    vigilType: o.vigilType,
    merchant: o.merchant,
    valueEstimate: o.valueEstimate,
    currency: o.currency,
    confidence: o.confidence,
    reason: o.reason,
    sourceRecordIds: [...new Set(o.sourceRecordIds)],
    status: 'open',
    meta: { merchantKey: o.merchantKey, ref: o.ref, ...o.meta },
  });
}
const policyOf = (ctx: DetectorContext, key: string): MerchantPolicy | undefined => ctx.policies.merchants[key];
const chargesFor = (ctx: DetectorContext, merchantKey: string, ref: string) => ctx.transactions.filter((t) => t.merchantKey === merchantKey && t.orderId === ref && t.amount > 0);

/** Recurring subscription still charging, with no usage signal within the policy's idle window. */
export const forgottenSubscription: Detector = (ctx) => {
  const out: Opportunity[] = [];
  for (const s of ctx.subscriptions) {
    const p = policyOf(ctx, s.merchantKey);
    if (!p || p.kind !== 'subscription' || !p.claimTypes.includes('cancel_subscription')) continue;
    if (daysBetween(s.lastCharge, ctx.today) > PERIOD_DAYS[s.cadence] + 7) continue; // no longer charging
    const idleDays = p.idleDays ?? 45;
    if (s.lastUseSignal && daysBetween(s.lastUseSignal, ctx.today) <= idleDays) continue;
    const trial = ctx.emails.find((e) => e.merchantKey === s.merchantKey && e.kind === 'trial_converted' && (!s.planId || e.fields.subscriptionId === s.planId));
    const trialStart = ctx.emails.find((e) => e.merchantKey === s.merchantKey && e.kind === 'trial_started' && (!s.planId || e.fields.subscriptionId === s.planId));
    const unused = s.transactionIds.map((id) => ctx.transactions.find((t) => t.id === id)!).filter((t) => !s.lastUseSignal || t.date > s.lastUseSignal);
    const annual = s.amount * PERIODS_PER_YEAR[s.cadence];
    const plan = s.planName ?? 'subscription';
    const usage = s.lastUseSignal
      ? `The last usage signal was ${humanDate(s.lastUseSignal)}, ${daysBetween(s.lastUseSignal, ctx.today)} days ago`
      : trial
        ? `There has been no usage at all since it converted from a free trial on ${humanDate(trial.fields.billingDate ?? trial.date)}`
        : 'There is no usage signal at all';
    out.push(
      opportunity({
        vigilType: 'forgotten_subscription',
        merchant: s.merchant,
        merchantKey: s.merchantKey,
        ref: s.planId ?? s.id,
        valueEstimate: annual,
        currency: s.currency,
        confidence: s.lastUseSignal ? 0.85 : 0.9,
        reason: `${s.merchant} ${plan} charges ${fmt(s.amount, s.currency)} ${CADENCE_WORD[s.cadence]} (${unused.length} unused charges, ${fmt(unused.reduce((a, t) => a + t.amount, 0), s.currency)}). ${usage}. Cancelling saves ${fmt(annual, s.currency)} a year.`,
        sourceRecordIds: [...s.transactionIds, ...s.usageEmailIds.slice(-3), ...(trialStart ? [trialStart.id] : []), ...(trial ? [trial.id] : [])],
        meta: {
          planId: s.planId,
          planName: s.planName,
          subscriptionId: s.id,
          amount: s.amount,
          cadence: s.cadence,
          lastCharge: s.lastCharge,
          nextCharge: s.nextCharge,
          lastUseSignal: s.lastUseSignal,
          unusedCharges: unused.length,
          unusedTotal: unused.reduce((a, t) => a + t.amount, 0),
          fromFreeTrial: Boolean(trial),
          cancellationPath: p.cancellation?.path ?? null,
          valueBasis: 'annual saving from cancelling',
        },
      }),
    );
  }
  return out;
};

/** Same merchant + amount + order ref charged more than once within N days, while email shows fewer orders. */
export const duplicateCharge: Detector = (ctx) => {
  const out: Opportunity[] = [];
  const groups = new Map<string, FindTransaction[]>();
  for (const t of ctx.transactions) {
    if (t.amount <= 0 || !t.orderId) continue;
    const k = `${t.merchantKey}|${t.orderId}|${t.amount}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const txns of groups.values()) {
    if (txns.length < 2) continue;
    const first = txns[0]!;
    const p = policyOf(ctx, first.merchantKey);
    const window = p?.duplicateChargeWindowDays ?? 3;
    const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
    if (daysBetween(sorted[0]!.date, sorted.at(-1)!.date) > window) continue;
    const orders = ctx.emails.filter((e) => e.merchantKey === first.merchantKey && e.kind === 'order_confirmation' && e.fields.orderId === first.orderId);
    if (orders.length === 0 || orders.length >= txns.length) continue; // need the receipt to prove fewer orders
    const extra = txns.length - orders.length;
    out.push(
      opportunity({
        vigilType: 'duplicate_charge',
        merchant: first.merchant,
        merchantKey: first.merchantKey,
        ref: first.orderId!,
        valueEstimate: extra * first.amount,
        currency: first.currency,
        confidence: 0.95,
        reason: `Order ${first.orderId} was charged ${txns.length} times (${fmt(first.amount, first.currency)} each, ${[...new Set(sorted.map((t) => t.date))].length === 1 ? `both on ${humanDate(sorted[0]!.date)}` : sorted.map((t) => humanDate(t.date)).join(' and ')}), but the order confirmation shows ${orders.length === 1 ? 'one order' : `${orders.length} orders`}. Request a refund of ${fmt(extra * first.amount, first.currency)}.`,
        sourceRecordIds: [...txns.map((t) => t.id), ...orders.map((e) => e.id)],
        meta: { orderId: first.orderId, item: orders[0]?.fields.item ?? null, amount: first.amount, timesCharged: txns.length, ordersConfirmed: orders.length },
      }),
    );
  }
  return out;
};

/** Purchased within the price-protection window and the merchant's catalog price is now lower. */
export const priceDrop: Detector = (ctx) => {
  const out: Opportunity[] = [];
  for (const e of ctx.emails) {
    if (e.kind !== 'order_confirmation' || !e.fields.orderId || !e.fields.item || e.fields.amount === undefined) continue;
    const p = policyOf(ctx, e.merchantKey);
    if (!p?.priceProtectionDays) continue;
    const purchased = e.fields.orderDate ?? e.date;
    const windowEnds = addDays(purchased, p.priceProtectionDays);
    if (ctx.today > windowEnds || ctx.today < purchased) continue;
    const catalog = ctx.catalogs.find((c) => c.merchant === e.merchantKey);
    const item = catalog?.items.find((i) => i.name.trim().toLowerCase() === e.fields.item!.trim().toLowerCase());
    if (!catalog || !item || item.priceNow >= e.fields.amount) continue;
    const diff = e.fields.amount - item.priceNow;
    const charges = chargesFor(ctx, e.merchantKey, e.fields.orderId);
    out.push(
      opportunity({
        vigilType: 'price_drop',
        merchant: e.merchant,
        merchantKey: e.merchantKey,
        ref: e.fields.orderId,
        valueEstimate: diff,
        currency: catalog.currency,
        confidence: charges.length ? 0.9 : 0.75,
        reason: `You paid ${fmt(e.fields.amount, catalog.currency)} for the ${e.fields.item} (order ${e.fields.orderId}, ${humanDate(purchased)}). It now costs ${fmt(item.priceNow, catalog.currency)}, and ${e.merchant}'s ${p.priceProtectionDays}-day price protection runs until ${humanDate(windowEnds)}. Claim the ${fmt(diff, catalog.currency)} difference.`,
        sourceRecordIds: [e.id, ...charges.map((t) => t.id), `${catalog.sourceId}#${item.sku ?? item.name}`],
        meta: { orderId: e.fields.orderId, item: e.fields.item, paid: e.fields.amount, priceNow: item.priceNow, purchasedOn: purchased, windowEndsOn: windowEnds, protectionDays: p.priceProtectionDays },
      }),
    );
  }
  return out;
};

/** Shipped, past the promised date plus the merchant's waiting period, and no delivery email. */
export const undeliveredOrder: Detector = (ctx) => {
  const out: Opportunity[] = [];
  for (const shipped of ctx.emails) {
    if (shipped.kind !== 'shipped' || !shipped.fields.orderId || !shipped.fields.promisedBy) continue;
    const orderId = shipped.fields.orderId;
    const p = policyOf(ctx, shipped.merchantKey);
    if (!p?.claimTypes.includes('non_delivery_claim')) continue;
    const delivered = ctx.emails.some((e) => e.merchantKey === shipped.merchantKey && e.kind === 'delivered' && e.fields.orderId === orderId);
    if (delivered) continue;
    const waiting = p.nonDeliveryWaitingDays ?? 7;
    const claimOpens = addDays(shipped.fields.promisedBy, waiting);
    if (ctx.today < claimOpens) continue;
    const order = ctx.emails.find((e) => e.merchantKey === shipped.merchantKey && e.kind === 'order_confirmation' && e.fields.orderId === orderId);
    const charges = chargesFor(ctx, shipped.merchantKey, orderId);
    const paid = order?.fields.amount ?? charges[0]?.amount;
    if (paid === undefined) continue;
    const currency = charges[0]?.currency ?? 'USD';
    const item = shipped.fields.item ?? order?.fields.item ?? 'order';
    out.push(
      opportunity({
        vigilType: 'undelivered_order',
        merchant: shipped.merchant,
        merchantKey: shipped.merchantKey,
        ref: orderId,
        valueEstimate: paid,
        currency,
        confidence: charges.length ? 0.85 : 0.7,
        reason: `${item} (order ${orderId}) shipped on ${humanDate(shipped.fields.shippedOn ?? shipped.date)} and was promised by ${humanDate(shipped.fields.promisedBy)}. There is no delivery email, ${daysBetween(shipped.fields.promisedBy, ctx.today)} days later, and ${shipped.merchant}'s non-delivery claims opened on ${humanDate(claimOpens)}. Claim the ${fmt(paid, currency)} back.`,
        sourceRecordIds: [shipped.id, ...(order ? [order.id] : []), ...charges.map((t) => t.id)],
        meta: { orderId, item, paid, shippedOn: shipped.fields.shippedOn ?? shipped.date, promisedBy: shipped.fields.promisedBy, claimOpensOn: claimOpens, trackingNumber: shipped.fields.trackingNumber ?? null },
      }),
    );
  }
  return out;
};

/** A delay at or above a compensation threshold with a qualifying category. Needs the specialist. */
export const flightCompensation: Detector = (ctx) => {
  const out: Opportunity[] = [];
  for (const e of ctx.emails) {
    if (e.kind !== 'delay' || e.fields.delayMinutes === undefined || !e.fields.bookingRef) continue;
    const comp = policyOf(ctx, e.merchantKey)?.compensation;
    if (!comp) continue;
    const category = (e.fields.delayCategory ?? '').toLowerCase();
    if (!category || comp.excludedCategories.some((c) => category.includes(c))) continue;
    if (!comp.qualifyingCategories.some((c) => category.includes(c))) continue;
    const rule = comp.rules.filter((r) => e.fields.delayMinutes! >= r.minDelayMinutes).sort((a, b) => b.amount - a.amount)[0];
    if (!rule) continue;
    const ref = e.fields.bookingRef;
    const booking = ctx.emails.find((b) => b.merchantKey === e.merchantKey && b.kind === 'booking' && b.fields.bookingRef === ref);
    const charges = chargesFor(ctx, e.merchantKey, ref);
    const h = Math.floor(e.fields.delayMinutes / 60);
    const m = e.fields.delayMinutes % 60;
    out.push(
      opportunity({
        vigilType: 'flight_compensation',
        merchant: e.merchant,
        merchantKey: e.merchantKey,
        ref,
        valueEstimate: rule.amount,
        currency: rule.currency,
        confidence: 0.8,
        reason: `Flight ${e.fields.flight ?? ''} ${e.fields.route ?? ''} (booking ${ref}) left ${h}h ${m}m late. The stated cause, "${e.fields.delayCategory}", is the carrier's responsibility, and ${e.merchant} pays ${fmt(rule.amount, rule.currency)} for delays of ${rule.minDelayMinutes / 60} hours or more. This claim needs a specialist.`.replace(/\s+/g, ' '),
        sourceRecordIds: [e.id, ...(booking ? [booking.id] : []), ...charges.map((t) => t.id)],
        meta: {
          bookingRef: ref,
          flight: e.fields.flight ?? null,
          route: e.fields.route ?? null,
          delayMinutes: e.fields.delayMinutes,
          delayCategory: e.fields.delayCategory,
          fare: booking?.fields.amount ?? charges[0]?.amount ?? null,
          rule: rule.label,
          needsSpecialist: comp.needsSpecialist,
        },
      }),
    );
  }
  return out;
};

/** A recurring bill priced above the market reference for the same plan: a bloc candidate. */
export const billAboveMarket: Detector = (ctx) => {
  const out: Opportunity[] = [];
  for (const s of ctx.subscriptions) {
    const p = policyOf(ctx, s.merchantKey);
    if (!p?.marketReferences?.length) continue;
    const refs = p.marketReferences.filter((r) => r.currency === s.currency);
    const ref = (s.planName && refs.find((r) => r.plan.toLowerCase() === s.planName!.toLowerCase())) || (refs.length === 1 ? refs[0] : undefined);
    if (!ref) continue;
    const monthly = Math.round((s.amount * PERIODS_PER_YEAR[s.cadence]) / 12);
    if (monthly <= ref.monthly * (1 + (p.aboveMarketTolerance ?? 0.1))) continue;
    const annualOver = (monthly - ref.monthly) * 12;
    out.push(
      opportunity({
        vigilType: 'bill_above_market',
        merchant: s.merchant,
        merchantKey: s.merchantKey,
        ref: ref.item,
        valueEstimate: annualOver,
        currency: s.currency,
        confidence: 0.7,
        reason: `You pay ${fmt(monthly, s.currency)} a month for ${s.merchant} ${s.planName ?? ''}; the market reference for the same plan is ${fmt(ref.monthly, s.currency)}. That is ${fmt(annualOver, s.currency)} a year above market. Join a bloc to bargain it down.`.replace(/\s+/g, ' '),
        sourceRecordIds: s.transactionIds,
        meta: { item: ref.item, plan: s.planName, monthly, marketMonthly: ref.monthly, marketSource: ref.source, subscriptionId: s.id, blocCandidate: true },
      }),
    );
  }
  return out;
};

export const DETECTORS: Record<VigilType, Detector> = {
  forgotten_subscription: forgottenSubscription,
  duplicate_charge: duplicateCharge,
  price_drop: priceDrop,
  undelivered_order: undeliveredOrder,
  flight_compensation: flightCompensation,
  bill_above_market: billAboveMarket,
};
