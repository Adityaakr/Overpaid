/**
 * Offline building support (tests and scripts/capacity.ts): preprod-shaped protocol parameters and an evaluator that
 * returns the execution units measured for the bloc contract (contracts/bloc/README.md "Measured cost", produced by
 * `pnpm --filter @overpaid/bloc-contract measure` with `aiken uplc eval` on real V3 script contexts).
 * Nothing here talks to the network.
 */
import { Effect, Redeemer, type Transaction } from '@evolution-sdk/evolution';
import type * as Provider from '@evolution-sdk/evolution/sdk/provider/Provider';

const costModel = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 1000 + i]));

/** Preprod (Conway) limits and fee parameters; cost-model numbers are placeholders (they only feed the 32-byte script data hash). */
export const PREPROD_PARAMS: Provider.ProtocolParameters = {
  minFeeA: 44, minFeeB: 155381, maxTxSize: 16384, maxValSize: 5000,
  keyDeposit: 2_000_000n, poolDeposit: 500_000_000n, drepDeposit: 500_000_000n, govActionDeposit: 100_000_000_000n,
  priceMem: 0.0577, priceStep: 0.0000721, maxTxExMem: 17_500_000n, maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: 4310n, collateralPercentage: 150, maxCollateralInputs: 3, minFeeRefScriptCostPerByte: 15,
  costModels: { PlutusV1: costModel(166), PlutusV2: costModel(175), PlutusV3: costModel(297) },
};

export const LIMITS = { maxTxSize: 16_384, maxTxExMem: 17_500_000n, maxTxExSteps: 10_000_000_000n, maxCollateralInputs: 3 } as const;

/** Measured totals (withdraw + N spends) per N, from contracts/bloc/README.md. */
export const MEASURED: ReadonlyArray<{ n: number; wMem: number; wCpu: number; sMem: number; sCpu: number }> = [
  { n: 1, wMem: 0.48e6, wCpu: 0.22e9, sMem: 0.08e6, sCpu: 0.03e9 },
  { n: 5, wMem: 1.15e6, wCpu: 0.46e9, sMem: 0.41e6, sCpu: 0.14e9 },
  { n: 10, wMem: 2.0e6, wCpu: 0.74e9, sMem: 0.9e6, sCpu: 0.31e9 },
  { n: 20, wMem: 3.68e6, wCpu: 1.32e9, sMem: 2.09e6, sCpu: 0.71e9 },
  { n: 30, wMem: 5.37e6, wCpu: 1.9e9, sMem: 3.56e6, sCpu: 1.19e9 },
  { n: 40, wMem: 7.06e6, wCpu: 2.48e9, sMem: 5.32e6, sCpu: 1.77e9 },
  { n: 50, wMem: 8.75e6, wCpu: 3.06e9, sMem: 7.36e6, sCpu: 2.44e9 },
];

/** Linear interpolation (extrapolation past 50 uses the last segment) of the measured cost for N pledges. */
export function measuredCost(n: number) {
  const pts = MEASURED;
  let i = pts.findIndex((p) => p.n >= n);
  if (i === -1) i = pts.length - 1;
  if (i === 0) i = 1;
  const a = pts[i - 1]!, b = pts[i]!;
  const t = (n - a.n) / (b.n - a.n);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    withdraw: { mem: BigInt(Math.ceil(lerp(a.wMem, b.wMem))), cpu: BigInt(Math.ceil(lerp(a.wCpu, b.wCpu))) },
    spends: { mem: BigInt(Math.ceil(lerp(a.sMem, b.sMem))), cpu: BigInt(Math.ceil(lerp(a.sCpu, b.sCpu))) },
  };
}

/** Evaluator returning the measured units: the reward redeemer gets the withdraw cost, spends share the spend total. */
export const measuredEvaluator = {
  evaluate: (tx: Transaction.Transaction) => {
    const rs = tx.witnessSet.redeemers?.toArray() ?? [];
    const spends = rs.filter((r) => r.tag === 'spend');
    const cost = measuredCost(Math.max(1, spends.length));
    const per = spends.length ? { mem: cost.spends.mem / BigInt(spends.length) + 1n, cpu: cost.spends.cpu / BigInt(spends.length) + 1n } : { mem: 0n, cpu: 0n };
    return Effect.succeed(
      rs.map((r) => {
        const u = r.tag === 'reward' ? cost.withdraw : r.tag === 'spend' ? per : { mem: 200_000n, cpu: 80_000_000n };
        return { ex_units: new Redeemer.ExUnits({ mem: u.mem, steps: u.cpu }), redeemer_index: Number(r.index), redeemer_tag: r.tag };
      }),
    );
  },
};
