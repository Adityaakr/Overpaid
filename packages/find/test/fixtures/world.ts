// Tiny builders for detector fixtures: hand-written worlds, independent of data/demo.
import type { DetectorContext } from '../../src/detectors.js';
import { loadPolicies } from '../../src/policies.js';
import type { EmailFields, EmailKind, EmailRecord, FindTransaction, Subscription } from '../../src/types.js';

let n = 0;
export function txn(date: string, merchantKey: string, amount: number, orderId: string | null = null, merchant = merchantKey): FindTransaction {
  n += 1;
  return { id: `t${n}`, sourceId: 'src_stmt', merchant, merchantKey, descriptor: `${merchantKey.toUpperCase()} ${orderId ?? ''}`.trim(), amount, currency: 'USD', date, orderId, card: '4417', normalisedBy: 'rule' };
}
export function email(date: string, merchantKey: string, kind: EmailKind, fields: EmailFields = {}, merchant = merchantKey): EmailRecord {
  n += 1;
  return { id: `e${n}`, sourceId: `src_e${n}`, messageId: null, date, from: { name: merchant, address: `x@${merchantKey}.demo` }, subject: kind, merchant, merchantKey, kind, fields, excerpt: '' };
}
export function sub(partial: Partial<Subscription> & Pick<Subscription, 'merchantKey' | 'amount' | 'lastCharge' | 'transactionIds'>): Subscription {
  return {
    id: `sub_${partial.merchantKey}_${partial.amount}`,
    merchant: partial.merchantKey,
    currency: 'USD',
    cadence: 'monthly',
    start: '2026-04-01',
    nextCharge: '2026-11-01',
    exactDate: true,
    exactAmount: true,
    planName: null,
    planId: null,
    lastUseSignal: null,
    usageEmailIds: [],
    ...partial,
  };
}
export function ctx(partial: Partial<DetectorContext>): DetectorContext {
  return { today: '2026-10-06', transactions: [], emails: [], subscriptions: [], catalogs: [], policies: loadPolicies(), ...partial };
}
