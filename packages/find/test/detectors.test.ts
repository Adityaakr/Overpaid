import { describe, expect, it } from 'vitest';
import { billAboveMarket, duplicateCharge, flightCompensation, forgottenSubscription, priceDrop, undeliveredOrder } from '../src/detectors.js';
import { ctx, email, sub, txn } from './fixtures/world.js';

describe('forgotten_subscription', () => {
  const charges = ['2026-07-02', '2026-08-02', '2026-09-02', '2026-10-02'].map((d) => txn(d, 'vistaflix', 2299));
  const base = { merchantKey: 'vistaflix', merchant: 'Vistaflix', amount: 2299, lastCharge: '2026-10-02', transactionIds: charges.map((c) => c.id), planId: 'vf-plan-x', planName: 'Premium 4K' };
  it('flags a charging subscription with an old usage signal', () => {
    const [o] = forgottenSubscription(ctx({ transactions: charges, subscriptions: [sub({ ...base, lastUseSignal: '2026-05-11' })] }));
    expect(o).toMatchObject({ vigilType: 'forgotten_subscription', valueEstimate: 2299 * 12, meta: { ref: 'vf-plan-x', planId: 'vf-plan-x', unusedCharges: 4 } });
    expect(o!.reason).toContain('11 May 2026');
    expect(o!.sourceRecordIds).toEqual(expect.arrayContaining(charges.map((c) => c.id)));
  });
  it('flags a never-used plan that came from a free trial', () => {
    const conv = email('2026-04-18', 'vistaflix', 'trial_converted', { subscriptionId: 'vf-plan-x', billingDate: '2026-04-18' });
    const [o] = forgottenSubscription(ctx({ transactions: charges, emails: [conv], subscriptions: [sub(base)] }));
    expect(o).toMatchObject({ confidence: 0.9, meta: { fromFreeTrial: true } });
    expect(o!.sourceRecordIds).toContain(conv.id);
  });
  it('ignores subscriptions in recent use, cancelled ones, and non-subscription merchants', () => {
    expect(forgottenSubscription(ctx({ subscriptions: [sub({ ...base, lastUseSignal: '2026-09-30' })] }))).toEqual([]);
    expect(forgottenSubscription(ctx({ subscriptions: [sub({ ...base, lastCharge: '2026-06-02' })] }))).toEqual([]);
    expect(forgottenSubscription(ctx({ subscriptions: [sub({ ...base, merchantKey: 'lumen-mobile' })] }))).toEqual([]);
    expect(forgottenSubscription(ctx({ subscriptions: [sub({ ...base, merchantKey: 'beanhouse' })] }))).toEqual([]);
  });
});

describe('duplicate_charge', () => {
  it('flags the same order charged twice when the receipt shows one order', () => {
    const a = txn('2026-09-21', 'cartwell', 4999, 'CW-1');
    const b = txn('2026-09-22', 'cartwell', 4999, 'CW-1');
    const order = email('2026-09-21', 'cartwell', 'order_confirmation', { orderId: 'CW-1', amount: 4999, item: 'Hoodie' });
    const [o] = duplicateCharge(ctx({ transactions: [a, b], emails: [order] }));
    expect(o).toMatchObject({ valueEstimate: 4999, meta: { ref: 'CW-1', timesCharged: 2, ordersConfirmed: 1 } });
    expect(o!.sourceRecordIds).toEqual([a.id, b.id, order.id]);
  });
  it('does not flag two genuine orders, charges outside the window, or charges without a receipt', () => {
    const a = txn('2026-09-21', 'cartwell', 4999, 'CW-2');
    const b = txn('2026-09-21', 'cartwell', 4999, 'CW-2');
    const orders = [1, 2].map(() => email('2026-09-21', 'cartwell', 'order_confirmation', { orderId: 'CW-2' }));
    expect(duplicateCharge(ctx({ transactions: [a, b], emails: orders }))).toEqual([]);
    const late = txn('2026-09-30', 'cartwell', 4999, 'CW-2');
    expect(duplicateCharge(ctx({ transactions: [a, late], emails: orders.slice(0, 1) }))).toEqual([]);
    expect(duplicateCharge(ctx({ transactions: [a, b] }))).toEqual([]);
    // Same amount, same day, no order ref (two coffees): never a duplicate.
    expect(duplicateCharge(ctx({ transactions: [txn('2026-09-21', 'beanhouse', 650), txn('2026-09-21', 'beanhouse', 650)] }))).toEqual([]);
  });
});

describe('price_drop', () => {
  const catalog = { merchant: 'cartwell', asOf: '2026-10-06', currency: 'USD', sourceId: 'src_cat', items: [{ name: 'Kettle', priceNow: 6450 }, { name: 'Lamp', priceNow: 2000 }, { name: 'Hoodie', priceNow: 4999 }] };
  const order = (id: string, item: string, amount: number, date: string) => email(date, 'cartwell', 'order_confirmation', { orderId: id, item, amount, orderDate: date });
  it('flags a lower catalog price inside the protection window', () => {
    const e = order('CW-9', 'Kettle', 8900, '2026-09-30');
    const [o] = priceDrop(ctx({ emails: [e], catalogs: [catalog], transactions: [txn('2026-09-30', 'cartwell', 8900, 'CW-9')] }));
    expect(o).toMatchObject({ valueEstimate: 2450, confidence: 0.9, meta: { ref: 'CW-9', windowEndsOn: '2026-10-14' } });
  });
  it('ignores drops outside the window, unchanged prices and merchants without price protection', () => {
    expect(priceDrop(ctx({ emails: [order('CW-8', 'Lamp', 3450, '2026-08-14')], catalogs: [catalog] }))).toEqual([]);
    expect(priceDrop(ctx({ emails: [order('CW-7', 'Hoodie', 4999, '2026-09-21')], catalogs: [catalog] }))).toEqual([]);
    const pm = email('2026-09-30', 'parcelo', 'order_confirmation', { orderId: 'PM-1', item: 'Kettle', amount: 8900 });
    expect(priceDrop(ctx({ emails: [pm], catalogs: [{ ...catalog, merchant: 'parcelo' }] }))).toEqual([]);
  });
});

describe('undelivered_order', () => {
  const shipped = (id: string, promisedBy: string) => email('2026-09-08', 'parcelo', 'shipped', { orderId: id, item: 'Dock', shippedOn: '2026-09-08', promisedBy });
  it('flags a shipped order past promised + waiting days with no delivery email', () => {
    const s = shipped('PM-1', '2026-09-16');
    const conf = email('2026-09-07', 'parcelo', 'order_confirmation', { orderId: 'PM-1', amount: 4290 });
    const [o] = undeliveredOrder(ctx({ emails: [s, conf], transactions: [txn('2026-09-07', 'parcelo', 4290, 'PM-1')] }));
    expect(o).toMatchObject({ valueEstimate: 4290, meta: { ref: 'PM-1', claimOpensOn: '2026-09-23' } });
  });
  it('ignores delivered orders and orders still inside the waiting period', () => {
    const s = shipped('PM-2', '2026-09-16');
    const d = email('2026-09-15', 'parcelo', 'delivered', { orderId: 'PM-2' });
    expect(undeliveredOrder(ctx({ emails: [s, d], transactions: [txn('2026-09-07', 'parcelo', 100, 'PM-2')] }))).toEqual([]);
    expect(undeliveredOrder(ctx({ emails: [shipped('PM-3', '2026-10-01')], transactions: [txn('2026-09-07', 'parcelo', 100, 'PM-3')] }))).toEqual([]);
  });
});

describe('flight_compensation', () => {
  const delay = (minutes: number, category: string) => email('2026-09-14', 'skylane', 'delay', { bookingRef: 'ABC123', flight: 'SK 1', route: 'A to B', delayMinutes: minutes, delayCategory: category });
  it('flags a >= 3h carrier-responsibility delay as needing a specialist', () => {
    const [o] = flightCompensation(ctx({ emails: [delay(252, 'Technical, carrier responsibility')] }));
    expect(o).toMatchObject({ valueEstimate: 40000, meta: { ref: 'ABC123', bookingRef: 'ABC123', needsSpecialist: true, delayMinutes: 252 } });
  });
  it('ignores short delays and excluded causes', () => {
    expect(flightCompensation(ctx({ emails: [delay(179, 'Technical, carrier responsibility')] }))).toEqual([]);
    expect(flightCompensation(ctx({ emails: [delay(300, 'Weather')] }))).toEqual([]);
    expect(flightCompensation(ctx({ emails: [delay(300, 'Air traffic control restrictions')] }))).toEqual([]);
  });
});

describe('bill_above_market', () => {
  it('flags a recurring bill above the market reference as a bloc candidate', () => {
    const [o] = billAboveMarket(ctx({ subscriptions: [sub({ merchantKey: 'globeroam', amount: 2400, lastCharge: '2026-10-03', transactionIds: ['a', 'b', 'c'], planName: 'Asia 20 GB' })] }));
    expect(o).toMatchObject({ valueEstimate: (2400 - 1500) * 12, meta: { ref: 'esim-asia-20gb', blocCandidate: true, marketMonthly: 1500 } });
  });
  it('ignores bills at or under market, within tolerance, or with no reference', () => {
    const s = (merchantKey: string, amount: number, planName: string | null) => sub({ merchantKey, amount, lastCharge: '2026-10-01', transactionIds: [], planName });
    expect(billAboveMarket(ctx({ subscriptions: [s('tunewave', 1099, 'Premium Individual'), s('lumen-mobile', 3800, 'SIM Only 50 GB'), s('globeroam', 1600, 'Asia 20 GB'), s('fitpulse', 5900, null)] }))).toEqual([]);
  });
});
