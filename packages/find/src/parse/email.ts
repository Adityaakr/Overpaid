import PostalMime from 'postal-mime';
import { normaliseSender } from '../normalise.js';
import { redact } from '../redact.js';
import type { EmailFields, EmailKind, EmailRecord } from '../types.js';
import { dateInZone, parseLooseDate, parseMoney, shortHash } from '../util.js';

const KIND_RULES: [EmailKind, RegExp][] = [
  ['trial_converted', /trial (?:has )?ended|trial ended|converted to paid/i],
  ['trial_started', /free trial (?:has )?(?:started|begun)|trial has started/i],
  ['delay', /\bdelay(?:ed)?\b|disruption/i],
  ['booking', /booking confirm|e-?ticket|itinerary/i],
  ['delivered', /\bdelivered\b/i],
  ['shipped', /\bshipped\b|on its way|dispatched/i],
  ['order_confirmation', /order confirm|thanks for your order|order received|order placed/i],
  ['usage', /you watched|continue watching|listening recap|checked in|data usage|you've used/i],
  ['receipt', /receipt|bill is ready|invoice|payment received|your bill/i],
];

export function classifyEmail(subject: string): EmailKind {
  for (const [kind, re] of KIND_RULES) if (re.test(subject)) return kind;
  return 'other';
}

/** "Label: value" lines from the plain-text body, keyed by lower-cased label. */
export function keyValues(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]{1,32}?)\s*:\s*(.+?)\s*$/);
    if (m && !out.has(m[1]!.toLowerCase())) out.set(m[1]!.toLowerCase(), m[2]!);
  }
  return out;
}

const pick = (kv: Map<string, string>, ...labels: string[]) => {
  for (const l of labels) {
    const v = kv.get(l);
    if (v) return v;
  }
  return undefined;
};

export function parseDuration(s: string): number | null {
  const hm = s.match(/(\d+)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = s.match(/(\d+)\s*min/i);
  return m ? Number(m[1]) : null;
}

export function extractFields(text: string): EmailFields {
  const kv = keyValues(text);
  const f: EmailFields = {};
  const set = <K extends keyof EmailFields>(k: K, v: EmailFields[K] | null | undefined) => {
    if (v !== undefined && v !== null && v !== '') f[k] = v;
  };
  const date = (...labels: string[]) => {
    const v = pick(kv, ...labels);
    return v ? parseLooseDate(v) : null;
  };
  set('orderId', pick(kv, 'order number', 'order id', 'order no', 'order')?.match(/[A-Z]{1,4}-?\d{3,8}/)?.[0]);
  set('orderDate', date('order date', 'ordered on'));
  const amountRaw = pick(kv, 'order total', 'amount charged', 'total', 'fare paid', 'amount', 'price', 'grand total');
  set('amount', amountRaw ? parseMoney(amountRaw) : null);
  set('item', pick(kv, 'item', 'product'));
  set('plan', pick(kv, 'plan', 'membership'));
  set('subscriptionId', pick(kv, 'subscription id', 'membership id'));
  set('billingDate', date('billing date', 'converted to paid', 'payment date'));
  set('shippedOn', date('shipped on', 'dispatched on'));
  set('promisedBy', date('estimated delivery', 'arrives by', 'promised by', 'delivery by', 'expected delivery'));
  set('deliveredOn', date('delivered on'));
  set('trackingNumber', pick(kv, 'tracking number', 'tracking'));
  set('bookingRef', pick(kv, 'booking reference', 'booking ref', 'pnr', 'confirmation code')?.match(/[A-Z0-9]{5,8}/)?.[0]);
  set('flight', pick(kv, 'flight'));
  set('route', pick(kv, 'route'));
  set('flightDate', date('date', 'flight date'));
  const delay = pick(kv, 'delay', 'delayed by', 'arrival delay');
  set('delayMinutes', delay ? parseDuration(delay) : null);
  set('delayCategory', pick(kv, 'reason category', 'delay reason', 'reason', 'cause'));
  set('watchedOn', date('watched on'));
  return f;
}

const stripHtml = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|h\d|li|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[ \t]+/g, ' ');

export interface ParseEmailOptions {
  timeZone?: string;
}

/** Parse one RFC 822 message (an .eml file or an mbox entry) into an EmailRecord. */
export async function parseEmail(bytes: Uint8Array | ArrayBuffer | string, sourceId: string, opts: ParseEmailOptions = {}): Promise<EmailRecord> {
  const msg = await PostalMime.parse(bytes);
  const text = msg.text?.trim() ? msg.text : stripHtml(msg.html ?? '');
  const subject = msg.subject ?? '';
  const from = { name: msg.from?.name ?? '', address: msg.from?.address ?? '' };
  const when = msg.date ? new Date(msg.date) : null;
  const date = when && !Number.isNaN(when.getTime()) ? dateInZone(when, opts.timeZone ?? 'UTC') : '1970-01-01';
  const who = normaliseSender(from);
  return {
    id: `eml_${shortHash(msg.messageId ?? `${sourceId}:${subject}:${date}`)}`,
    sourceId,
    messageId: msg.messageId ?? null,
    date,
    from,
    subject,
    merchant: who.merchant,
    merchantKey: who.merchantKey,
    kind: classifyEmail(subject),
    fields: extractFields(text),
    excerpt: redact(text.replace(/\s+/g, ' ').trim().slice(0, 280)),
  };
}
