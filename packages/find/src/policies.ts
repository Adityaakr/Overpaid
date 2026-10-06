import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const MarketReference = z.object({
  plan: z.string(),
  item: z.string(),
  monthly: z.number().int(),
  currency: z.string().length(3),
  source: z.string(),
});
export const CompensationRule = z.object({ minDelayMinutes: z.number().int(), amount: z.number().int(), currency: z.string().length(3), label: z.string() });

export const MerchantPolicy = z.object({
  name: z.string(),
  kind: z.enum(['subscription', 'retail', 'marketplace', 'airline', 'bill', 'utility']),
  returnWindowDays: z.number().int().nullable(),
  priceProtectionDays: z.number().int().nullable(),
  duplicateChargeWindowDays: z.number().int().optional(),
  nonDeliveryWaitingDays: z.number().int().optional(),
  idleDays: z.number().int().optional(),
  cancellation: z.object({ path: z.string(), url: z.string(), effective: z.string(), refundsLastCharge: z.boolean() }).nullable(),
  claimTypes: z.array(z.string()),
  compensation: z
    .object({
      needsSpecialist: z.boolean(),
      qualifyingCategories: z.array(z.string()),
      excludedCategories: z.array(z.string()),
      rules: z.array(CompensationRule),
    })
    .optional(),
  marketReferences: z.array(MarketReference).optional(),
  aboveMarketTolerance: z.number().optional(),
});
export type MerchantPolicy = z.infer<typeof MerchantPolicy>;

export const PolicyLibrary = z.object({
  version: z.number().int(),
  asOf: z.string(),
  note: z.string().optional(),
  merchants: z.record(z.string(), MerchantPolicy),
});
export type PolicyLibrary = z.infer<typeof PolicyLibrary>;

let cached: PolicyLibrary | null = null;
/** The bundled policy library (packages/find/policies.json), validated. */
export function loadPolicies(): PolicyLibrary {
  cached ??= PolicyLibrary.parse(JSON.parse(readFileSync(new URL('../policies.json', import.meta.url), 'utf8')));
  return cached;
}
