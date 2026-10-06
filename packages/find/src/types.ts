import { z } from 'zod';
import { Opportunity, Transaction, VigilType } from '@overpaid/shared';

export { Opportunity, Transaction, VigilType };

/** A statement transaction with the merchant key Find resolved. Amount > 0 is a charge, < 0 a credit. */
export const FindTransaction = Transaction.extend({
  merchantKey: z.string(),
  card: z.string().nullable(),
  normalisedBy: z.string(),
});
export type FindTransaction = z.infer<typeof FindTransaction>;

export const EMAIL_KINDS = [
  'receipt',
  'order_confirmation',
  'shipped',
  'delivered',
  'booking',
  'delay',
  'usage',
  'trial_started',
  'trial_converted',
  'other',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailFields {
  orderId?: string;
  orderDate?: string;
  amount?: number;
  item?: string;
  plan?: string;
  subscriptionId?: string;
  billingDate?: string;
  shippedOn?: string;
  promisedBy?: string;
  deliveredOn?: string;
  trackingNumber?: string;
  bookingRef?: string;
  flight?: string;
  route?: string;
  flightDate?: string;
  delayMinutes?: number;
  delayCategory?: string;
  watchedOn?: string;
}

/** One parsed email. Raw bodies are not kept; `excerpt` is redacted. */
export interface EmailRecord {
  id: string;
  sourceId: string;
  messageId: string | null;
  date: string; // ISO date
  from: { name: string; address: string };
  subject: string;
  merchant: string;
  merchantKey: string;
  kind: EmailKind;
  fields: EmailFields;
  excerpt: string;
}

export interface SourceFile {
  id: string;
  name: string;
  kind: 'eml' | 'mbox' | 'statement_csv' | 'statement_pdf' | 'catalog' | 'ignored';
  records: number;
  warnings: string[];
}

export const CatalogFile = z.object({
  merchant: z.string(),
  name: z.string().optional(),
  asOf: z.string(),
  currency: z.string().length(3),
  items: z.array(z.object({ sku: z.string().optional(), name: z.string(), priceNow: z.number().int() })),
});
export type CatalogFile = z.infer<typeof CatalogFile>;
export interface Catalog extends CatalogFile {
  sourceId: string;
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'monthly_last_day';

/** A recurring charge found by the cadence search (ported from Actual's findSchedules). */
export interface Subscription {
  id: string;
  merchant: string;
  merchantKey: string;
  amount: number;
  currency: string;
  cadence: Cadence;
  start: string; // first matched occurrence
  lastCharge: string;
  nextCharge: string;
  exactDate: boolean;
  exactAmount: boolean;
  transactionIds: string[];
  planName: string | null;
  planId: string | null;
  lastUseSignal: string | null; // ISO date of the latest usage email, if any
  usageEmailIds: string[];
}

export interface FindTimings {
  parseMs: number;
  normaliseMs: number;
  recurringMs: number;
  detectMs: number;
  totalMs: number;
}

export interface FindResult {
  sources: SourceFile[];
  emails: EmailRecord[];
  transactions: FindTransaction[];
  subscriptions: Subscription[];
  opportunities: Opportunity[];
  total: { amount: number; currency: string; count: number };
  timings: FindTimings;
}
