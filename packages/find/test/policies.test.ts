import { describe, expect, it } from 'vitest';
import { CARTWELL_PRICE_PROTECTION_DAYS, PARCELO_WAITING_DAYS, SKYLANE_FLIGHT, MERCHANTS } from '@overpaid/shared';
import { loadPolicies } from '../src/policies.js';

// policies.json is data, so it cannot import demo-world; this guard keeps the two from drifting.
describe('policy library', () => {
  const p = loadPolicies();
  it('validates and covers every demo merchant', () => {
    for (const key of Object.keys(MERCHANTS)) expect(p.merchants[key]?.name).toBe(MERCHANTS[key as keyof typeof MERCHANTS].name);
  });
  it('matches demo-world terms', () => {
    expect(p.merchants.cartwell!.priceProtectionDays).toBe(CARTWELL_PRICE_PROTECTION_DAYS);
    expect(p.merchants.parcelo!.nonDeliveryWaitingDays).toBe(PARCELO_WAITING_DAYS);
    const rule = p.merchants.skylane!.compensation!.rules.find((r) => SKYLANE_FLIGHT.delayMinutes >= r.minDelayMinutes);
    expect(rule?.amount).toBe(SKYLANE_FLIGHT.compensation);
    expect(rule?.minDelayMinutes).toBe(180);
  });
});
