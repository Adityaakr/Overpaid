/**
 * Settlement capacity for the bloc contract (docs/BRIEF.md "Capacity").
 *   pnpm exec tsx scripts/capacity.ts            # or: node --import tsx scripts/capacity.ts
 *
 * Offline: builds the real settlement transaction for N pledges with Evolution (services/bloc applySettle, the
 * applied bloc script, preprod size/fee parameters), measures its exact serialized size with fake witnesses, and
 * charges the execution units measured on the compiled script with `aiken uplc eval` (contracts/bloc/README.md,
 * `pnpm --filter @overpaid/bloc-contract measure`). Preprod limits: maxTxSize 16384, maxTxExMem 17.5M,
 * maxTxExSteps 10B, maxCollateralInputs 3. N_max = the largest N that fits with >= 25% execution-memory headroom.
 * Confirm on preprod with a real settlement once BLOCKFROST_PROJECT_ID is set.
 */
import { measureSettlement, type CapacityRow } from '../services/bloc/src/capacity.ts';
import { LIMITS, MEASURED } from '../services/bloc/src/offline.ts';

const pct = (a: bigint | number, b: bigint | number) => `${((Number(a) / Number(b)) * 100).toFixed(1)}%`;
const HEADROOM = 0.75;

async function scan(label: string, o: { referenceScript: boolean; enterpriseRefunds: boolean }) {
  console.log(`\n${label}`);
  console.log('N   | size (of 16384)      | mem (of 17.5M)        | cpu (of 10B)          | fee (tADA) | fits');
  const rows: CapacityRow[] = [];
  let hardMax = 0, nMax = 0;
  for (let n = 1; n <= 70; n++) {
    const r = await measureSettlement(n, o);
    rows.push(r);
    if (r.fits) hardMax = n;
    if (r.fits && Number(r.mem) <= Number(LIMITS.maxTxExMem) * HEADROOM && Number(r.cpu) <= Number(LIMITS.maxTxExSteps) * HEADROOM) nMax = n;
    if ([1, 5, 10, 20, 30, 40, 45, 50, 55, 60, 70].includes(n)) {
      console.log(`${String(n).padEnd(4)}| ${String(r.size).padEnd(6)} ${pct(r.size, LIMITS.maxTxSize).padEnd(13)} | ${String(r.mem).padEnd(9)} ${pct(r.mem, LIMITS.maxTxExMem).padEnd(11)} | ${String(r.cpu).padEnd(11)} ${pct(r.cpu, LIMITS.maxTxExSteps).padEnd(9)} | ${(Number(r.fee) / 1e6).toFixed(3).padEnd(10)} | ${r.fits ? 'yes' : 'NO'}`);
    }
    if (!r.fits && n > hardMax + 3) break;
  }
  const a = rows[0]!, b = rows.at(-1)!;
  const perPledge = (b.size - a.size) / (b.n - a.n);
  const sizeOver = rows.find((r) => r.size > LIMITS.maxTxSize);
  const bySize = sizeOver ? `N <= ${sizeOver.n - 1}` : `N <= ~${Math.floor(a.n + (LIMITS.maxTxSize - a.size) / perPledge)} (projected, ${perPledge.toFixed(0)} bytes/pledge)`;
  const byMem = rows.filter((r) => r.mem <= LIMITS.maxTxExMem).at(-1)?.n ?? 0;
  const measured = MEASURED.map((m) => m.n).filter((n) => n <= nMax).at(-1) ?? nMax;
  console.log(`limit by size: ${bySize}; by execution memory: N <= ${byMem}; hard max ${hardMax}; with 25% headroom N <= ${nMax}; largest measured point within it: ${measured}`);
  return measured;
}

const withRef = await scan('Reference script (bloc script published at the bloc address), base refund addresses:', { referenceScript: true, enterpriseRefunds: false });
const inline = await scan('Inline script (no reference script), base refund addresses:', { referenceScript: false, enterpriseRefunds: false });
await scan('Reference script, enterprise refund addresses:', { referenceScript: true, enterpriseRefunds: true });
console.log(`\nN_max = ${Math.min(withRef, inline)} (reference script ${withRef}, inline script ${inline}). services/bloc uses BLOC_N_MAX (default 40).`);
console.log('Execution units: measured per N with aiken uplc eval (interpolated between measured points); size: exact Evolution build.');
