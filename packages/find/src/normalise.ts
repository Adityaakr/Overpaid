// Merchant normalisation: card descriptors and email senders -> one canonical merchant.
// Rules first (deterministic, explainable); an optional model fallback only ever sees redacted text.
import { ESIM_BILL, MERCHANTS, type MerchantKey } from '@overpaid/shared';
import { redact } from './redact.js';

export interface MerchantIdentity {
  merchant: string; // display name
  merchantKey: string; // stable key; demo merchants use their MerchantKey
  rule: string; // which rule matched (for "show your work")
}

export interface DescriptorRule {
  key: string;
  name: string;
  /** Matched against the upper-cased descriptor. */
  pattern: RegExp;
  /** Sender domains that identify this merchant in email. */
  domains?: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** First word of a descriptor, e.g. "VISTAFLIX*STREAM" -> "VISTAFLIX", "CARTWELL.COM ORDER" -> "CARTWELL". */
const stem = (descriptor: string) => descriptor.split(/[*\s.#]/)[0]!;

// Demo merchants come straight from demo-world, so descriptors can never drift from the generator.
const DEMO_RULES: DescriptorRule[] = (Object.keys(MERCHANTS) as MerchantKey[]).map((key) => ({
  key,
  name: MERCHANTS[key].name,
  pattern: new RegExp(`^(?:[A-Z]{2,4}\\s?\\*\\s?)?${esc(stem(MERCHANTS[key].descriptor))}\\b`),
  domains: [MERCHANTS[key].domain],
}));

/** Clean-up rules table. Order matters: first match wins. */
export const DESCRIPTOR_RULES: DescriptorRule[] = [
  ...DEMO_RULES,
  { key: 'globeroam', name: ESIM_BILL.merchant, pattern: /^GLOBE\s?ROAM\b/, domains: ['globeroam.demo'] },
  { key: 'tunewave', name: 'Tunewave', pattern: /^TUNEWAVE\b/, domains: ['tunewave.demo'] },
  { key: 'fitpulse', name: 'FitPulse Club', pattern: /^FITPULSE\b/, domains: ['fitpulse.demo'] },
  { key: 'lumen-mobile', name: 'Lumen Mobile', pattern: /^LUMEN\s+MOBILE\b/, domains: ['lumenmobile.demo'] },
  { key: 'brightgrid', name: 'Brightgrid Energy', pattern: /^BRIGHTGRID\b/, domains: ['brightgrid.demo'] },
  { key: 'zipride', name: 'ZipRide', pattern: /^ZIPRIDE\b/, domains: ['zipride.demo'] },
  { key: 'freshmart', name: 'FreshMart', pattern: /^FRESHMART\b/, domains: ['freshmart.demo'] },
  { key: 'beanhouse', name: 'Beanhouse Coffee', pattern: /^BEANHOUSE\b/ },
  { key: 'transitlink', name: 'TransitLink', pattern: /^TRANSITLINK\b/ },
];

const NOISE_PREFIX = /^(?:SQ|TST|PAYPAL|PP|SP|GOOGLE|APL|APPLE\.COM\/BILL|AMZN MKTP)\s*\*\s*/;
const NOISE_WORDS = /\b(?:ORDER|TKT|BILL|TOPUP|PAYMENT|PURCHASE|ONLINE|POS|DEBIT|CARD|REFUND|RECURRING|SUBSCRIPTION|INC|LLC|LTD|PTE)\b/g;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Generic clean-up for descriptors no rule knows: "SQ *NOODLE BAR 21 #0042" -> "Noodle Bar". */
export function cleanDescriptor(descriptor: string): string {
  let s = descriptor.toUpperCase().trim().replace(NOISE_PREFIX, '');
  s = s.replace(/\b[A-Z]{1,3}-\d{3,7}\b/g, ' '); // order refs
  s = s.replace(/\*.*$/, ' '); // "BRAND*PRODUCT" -> BRAND
  s = s.replace(/#\s*\d+/g, ' ').replace(/\b\d+\b/g, ' ');
  s = s.replace(/\.COM\b/g, ' ').replace(NOISE_WORDS, ' ');
  s = s.replace(/[^A-Z0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(s) || titleCase(descriptor.trim());
}

/** Rules-only normalisation of a card descriptor. */
export function normaliseDescriptor(descriptor: string): MerchantIdentity & { matched: boolean } {
  const up = descriptor.toUpperCase().trim().replace(NOISE_PREFIX, '');
  for (const r of DESCRIPTOR_RULES) if (r.pattern.test(up)) return { merchant: r.name, merchantKey: r.key, rule: `rule:${r.key}`, matched: true };
  const name = cleanDescriptor(descriptor);
  return { merchant: name, merchantKey: slug(name), rule: 'cleanup', matched: false };
}

/** Identify an email's merchant from its sender domain, falling back to the display name. */
export function normaliseSender(from: { name?: string; address?: string }): MerchantIdentity & { matched: boolean } {
  const domain = (from.address ?? '').split('@')[1]?.toLowerCase() ?? '';
  for (const r of DESCRIPTOR_RULES) {
    if (r.domains?.some((d) => domain === d || domain.endsWith(`.${d}`))) return { merchant: r.name, merchantKey: r.key, rule: `domain:${r.key}`, matched: true };
  }
  if (from.name) {
    const byName = normaliseDescriptor(from.name);
    if (byName.matched) return byName;
  }
  const name = from.name?.trim() || domain.split('.')[0] || 'Unknown';
  return { merchant: name, merchantKey: slug(name), rule: 'sender', matched: false };
}

/** A model hook. It receives ONLY redacted text and returns a canonical merchant name, or null. */
export type ModelNormaliser = (redactedDescriptor: string) => Promise<string | null>;

/** Rules first; the model is consulted only for unmatched descriptors, and only with redacted text. */
export async function normaliseWithModel(descriptor: string, model?: ModelNormaliser): Promise<MerchantIdentity> {
  const byRule = normaliseDescriptor(descriptor);
  if (byRule.matched || !model) return byRule;
  const answer = await model(redact(descriptor));
  if (!answer) return byRule;
  const known = normaliseDescriptor(answer);
  return known.matched ? { ...known, rule: 'model' } : { merchant: answer, merchantKey: slug(answer), rule: 'model' };
}
