import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TODAY, EXPECTED_FIX_TASKS, ESIM_BILL, VISTAFLIX_PLANS } from '@overpaid/shared';
import { runFind } from '../src/run.js';
import type { FindResult } from '../src/types.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DEMO = `${ROOT}data/demo`;

describe('Find on data/demo', () => {
  let r: FindResult;
  let wallMs = 0;
  beforeAll(async () => {
    if (!existsSync(`${DEMO}/statement.csv`)) execFileSync('pnpm', ['demo:data'], { cwd: ROOT, stdio: 'inherit' });
    const t0 = performance.now();
    r = await runFind({ dir: DEMO }, { today: DEMO_TODAY });
    wallMs = performance.now() - t0;
  }, 60_000);

  it('reads the whole dataset', () => {
    expect(r.emails.length).toBeGreaterThan(150);
    expect(r.transactions.length).toBeGreaterThanOrEqual(280);
    expect(r.sources.filter((s) => s.warnings.length)).toEqual([]);
    expect(r.sources.filter((s) => s.kind === 'catalog')).toHaveLength(1);
  });

  it('produces exactly the 8 expected Fix tasks plus one bill_above_market', () => {
    const got = r.opportunities.map((o) => ({ merchant: o.meta.merchantKey, vigil: o.vigilType, ref: o.meta.ref }));
    const fix = got.filter((g) => g.vigil !== 'bill_above_market');
    const key = (x: { merchant: unknown; vigil: unknown; ref: unknown }) => `${x.merchant}|${x.vigil}|${x.ref}`;
    expect(fix.map(key).sort()).toEqual(EXPECTED_FIX_TASKS.map(key).sort());
    const blocs = got.filter((g) => g.vigil === 'bill_above_market');
    expect(blocs).toEqual([{ merchant: 'globeroam', vigil: 'bill_above_market', ref: 'esim-asia-20gb' }]);
    expect(r.opportunities).toHaveLength(EXPECTED_FIX_TASKS.length + 1);
  });

  it('raises nothing for texture merchants', () => {
    const demo = new Set(['vistaflix', 'cartwell', 'skylane', 'parcelo', 'globeroam']);
    expect(r.opportunities.filter((o) => !demo.has(String(o.meta.merchantKey)))).toEqual([]);
  });

  it('every opportunity has a reason and resolvable source records', () => {
    const ids = new Set([...r.transactions.map((t) => t.id), ...r.emails.map((e) => e.id)]);
    for (const o of r.opportunities) {
      expect(o.reason.length).toBeGreaterThan(40);
      expect(o.valueEstimate).toBeGreaterThan(0);
      expect(o.sourceRecordIds.length).toBeGreaterThan(0);
      for (const id of o.sourceRecordIds) expect(ids.has(id) || id.startsWith('src_')).toBe(true);
    }
  });

  it('finds the recurring subscriptions and their usage signals', () => {
    const vf = r.subscriptions.filter((s) => s.merchantKey === 'vistaflix');
    expect(vf.map((s) => s.planId).sort()).toEqual(VISTAFLIX_PLANS.map((p) => p.id).sort());
    expect(vf.find((s) => s.planId === 'vf-plan-premium')?.lastUseSignal).toBe(VISTAFLIX_PLANS[0]!.lastWatched);
    expect(vf.find((s) => s.planId === 'vf-plan-basic')?.nextCharge).toBe(VISTAFLIX_PLANS[1]!.nextRenewal);
    expect(r.subscriptions.find((s) => s.merchantKey === 'globeroam')?.amount).toBe(ESIM_BILL.amount);
    expect(r.subscriptions.map((s) => s.merchantKey)).not.toContain('beanhouse');
  });

  it('computes money on the table', () => {
    expect(r.total.amount).toBe(r.opportunities.reduce((a, o) => a + o.valueEstimate, 0));
    expect(r.total).toMatchObject({ currency: 'USD', count: 9 });
    expect(r.total.amount).toBeGreaterThan(0);
  });

  it('is deterministic', async () => {
    const again = await runFind({ dir: DEMO }, { today: DEMO_TODAY });
    expect(again.opportunities).toEqual(r.opportunities);
  });

  it('runs well under 60 seconds (< 10 s)', () => {
    expect(wallMs).toBeLessThan(10_000);
    expect(r.timings.totalMs).toBeLessThan(10_000);
  });
});
