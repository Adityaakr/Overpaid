import { expect, test } from '@playwright/test';
import { CARTWELL_ORDERS, PARCELO_ORDERS, SKYLANE_FLIGHT, VISTAFLIX_PLANS, type MerchantKey } from '@overpaid/shared';
import { cartwellDuplicate, cartwellPriceAdjust, parceloUndelivered, skylaneClaim, vistaflixCancel, type RecipeResult } from '../scripted/index.js';
import { approver, base, getJson, reset } from './helpers.js';

const RUNS = 3;

type Case = {
  name: string;
  merchant: MerchantKey;
  code: RegExp;
  amountCents: number;
  finalStatus: string;
  run: (page: import('@playwright/test').Page, a: ReturnType<typeof approver>) => Promise<RecipeResult>;
  /** Machine-readable status from the merchant's own JSON endpoint, as the verifier would read it. */
  verify: (request: import('@playwright/test').APIRequestContext, code: string) => Promise<{ status: unknown; amountCents: unknown }>;
};

const priceDrop = (id: string) => {
  const o = CARTWELL_ORDERS.find((x) => x.orderId === id)!;
  return o.paid - (('priceNow' in o ? o.priceNow : undefined) ?? o.paid);
};

const cases: Case[] = [
  ...VISTAFLIX_PLANS.map((p): Case => ({
    name: `vistaflix-cancel(${p.id})`,
    merchant: 'vistaflix',
    code: /^VF-CXL-[A-Z0-9]{4}$/,
    amountCents: p.amount,
    finalStatus: 'cancelled',
    run: (page, a) => vistaflixCancel(page, { planId: p.id, baseUrl: base('vistaflix'), requestApproval: a.requestApproval }),
    verify: async (request) => {
      const j = await getJson<{ plans: { planId: string; status: string; amountCents: number }[] }>(request, `${base('vistaflix')}/account/status.json`);
      const plan = j.plans.find((x) => x.planId === p.id)!;
      return { status: plan.status, amountCents: plan.amountCents };
    },
  })),
  {
    name: 'cartwell-duplicate(CW-4417)',
    merchant: 'cartwell',
    code: /^CW-T-\d{4}$/,
    amountCents: 4999,
    finalStatus: 'refund_issued',
    run: (page, a) => cartwellDuplicate(page, { baseUrl: base('cartwell'), requestApproval: a.requestApproval, waitForFinal: true, finalTimeoutMs: 20_000 }),
    verify: async (request, code) => getJson(request, `${base('cartwell')}/support/tickets/${code}.json`) as Promise<{ status: unknown; amountCents: unknown }>,
  },
  ...['CW-4502', 'CW-4511'].map((orderId): Case => ({
    name: `cartwell-price-adjust(${orderId})`,
    merchant: 'cartwell',
    code: /^CW-T-\d{4}$/,
    amountCents: priceDrop(orderId),
    finalStatus: 'price_adjustment_issued',
    run: (page, a) => cartwellPriceAdjust(page, { orderId, baseUrl: base('cartwell'), requestApproval: a.requestApproval, waitForFinal: true, finalTimeoutMs: 20_000 }),
    verify: async (request, code) => getJson(request, `${base('cartwell')}/support/tickets/${code}.json`) as Promise<{ status: unknown; amountCents: unknown }>,
  })),
  ...PARCELO_ORDERS.filter((o) => !o.delivered).map((o): Case => ({
    name: `parcelo-undelivered(${o.orderId})`,
    merchant: 'parcelo',
    code: /^PMC-\d{5}$/,
    amountCents: o.paid,
    finalStatus: 'refund_approved',
    run: (page, a) => parceloUndelivered(page, { orderId: o.orderId, baseUrl: base('parcelo'), requestApproval: a.requestApproval }),
    verify: async (request) => getJson(request, `${base('parcelo')}/orders/${o.orderId}.json`) as Promise<{ status: unknown; amountCents: unknown }>,
  })),
  {
    name: 'skylane-claim(SKX7Q2)',
    merchant: 'skylane',
    code: /^SKC-\d{4}$/,
    amountCents: SKYLANE_FLIGHT.compensation,
    finalStatus: 'paid',
    run: (page, a) => skylaneClaim(page, { baseUrl: base('skylane'), requestApproval: a.requestApproval, waitForFinal: true, finalTimeoutMs: 20_000 }),
    verify: async (request, code) => getJson(request, `${base('skylane')}/claims/${code}.json`) as Promise<{ status: unknown; amountCents: unknown }>,
  },
];

for (const c of cases) {
  test(`${c.name} succeeds ${RUNS} times in a row`, async ({ page, request, context }) => {
    for (let i = 1; i <= RUNS; i++) {
      await reset(request, c.merchant);
      await context.clearCookies();
      const a = approver();
      const res = await c.run(page, a);
      expect(res.error, `run ${i}: ${res.error}`).toBeUndefined();
      expect(res.outcome, `run ${i}`).toBe('success');
      expect(res.merchantStatus).toBe(c.finalStatus);
      expect(res.confirmationCode).toMatch(c.code);
      expect(res.amountCents).toBe(c.amountCents);
      expect(a.calls, 'approval requested exactly once, before the irreversible step').toHaveLength(1);
      const irreversibleIdx = res.steps.findIndex((s) => s.action.includes('(irreversible)'));
      const approvalIdx = res.steps.findIndex((s) => s.action.startsWith('approval granted'));
      expect(approvalIdx).toBeGreaterThanOrEqual(0);
      expect(approvalIdx).toBeLessThan(irreversibleIdx);
      const v = await c.verify(request, res.confirmationCode!);
      expect(v.status).toBe(c.finalStatus);
      expect(v.amountCents).toBe(c.amountCents);
    }
  });
}

test('denied approval leaves the merchant state unchanged', async ({ page, request }) => {
  await reset(request, 'vistaflix');
  const res = await vistaflixCancel(page, { planId: 'vf-plan-premium', baseUrl: base('vistaflix'), requestApproval: async () => false });
  expect(res.outcome).toBe('approval_denied');
  const j = await getJson<{ plans: { planId: string; status: string }[] }>(request, `${base('vistaflix')}/account/status.json`);
  expect(j.plans.every((p) => p.status === 'active')).toBe(true);
});

test('Vistaflix confirmation code is deterministic per plan', async ({ page, request }) => {
  const codes: string[] = [];
  for (let i = 0; i < 2; i++) {
    await reset(request, 'vistaflix');
    const res = await vistaflixCancel(page, { planId: 'vf-plan-basic', baseUrl: base('vistaflix'), requestApproval: async () => true });
    codes.push(res.confirmationCode!);
  }
  expect(codes[0]).toBe(codes[1]);
});
