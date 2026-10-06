/**
 * Settlement capacity, offline: builds a real settlement transaction for N pledges with Evolution (the same
 * applySettle the service submits, the real applied bloc script, preprod fee/size parameters), signs it with fake
 * witnesses for an exact size, and charges each redeemer the execution units measured with `aiken uplc eval`
 * (contracts/bloc/README.md "Measured cost"). Used by scripts/capacity.ts.
 */
import { createHash } from 'node:crypto';
import { Address, Assets, InlineDatum, Transaction, TransactionHash, UTxO, preprod } from '@evolution-sdk/evolution';
import { makeTxBuilder } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import {
  blocAddress, blocScript, campaignDatumData, campaignPolicy, pledgeDatumData, plutusAddressToBech32, signBid, vkeyFromSecret,
  type Bid, type CampaignDatum, type PlutusAddress,
} from '@overpaid/bloc-contract';
import { LIMITS, PREPROD_PARAMS, measuredEvaluator } from './offline.js';
import { planSettlement, validatePledge, type ValidPledge } from './planner.js';
import { applySettle, chainPledgeOf } from './txs.js';
import { MAX_PLEDGE_LOVELACE, PLEDGE_LOCK_LOVELACE } from './units.js';

const h = (s: string) => createHash('sha256').update(s).digest('hex');
const seed = { txHash: '5e'.repeat(32), index: 1 };
const policy = campaignPolicy(seed);
const bloc = blocScript(policy.hash);
const scriptAddr = blocAddress(bloc.hash, 0);
const sk = new Uint8Array(32).fill(7);
const blocId = Buffer.from('esim-eu-30d-capacity').toString('hex');
const datum: CampaignDatum = {
  blocId, itemHash: h('item'), asset: { policy: '', name: '' }, membersLimit: 150n, minBatch: 1n,
  bidDeadline: 1_790_000_000_000n, refundDeadline: 1_790_100_000_000n, providerVkeys: [vkeyFromSecret(sk), 'aa'.repeat(32), 'bb'.repeat(32)],
};
const info = { policyId: policy.hash, ...datum };
const keyAddr = (n: number, enterprise: boolean): PlutusAddress => ({
  payment: { type: 'key', hash: h(`pay${n}`).slice(0, 56) },
  ...(enterprise ? {} : { stake: { type: 'key' as const, hash: h(`stake${n}`).slice(0, 56) } }),
});
const utxo = (tag: string, index: number, address: string, assets: Assets.Assets, extra: Partial<{ datumOption: InlineDatum.InlineDatum; scriptRef: typeof bloc.script }> = {}) =>
  new UTxO.UTxO({ transactionId: TransactionHash.fromHex(h(tag)), index: BigInt(index), address: Address.fromBech32(address), assets, ...extra });

export interface CapacityRow {
  n: number;
  size: number;
  fee: bigint;
  mem: bigint;
  cpu: bigint;
  fits: boolean;
}

export async function measureSettlement(n: number, o: { referenceScript: boolean; enterpriseRefunds: boolean }): Promise<CapacityRow> {
  const admin = plutusAddressToBech32(keyAddr(999_999, false));
  const campaignUtxo = utxo('campaign', 0, scriptAddr, Assets.fromHexStrings(policy.hash, blocId, 1n, 2_000_000n), { datumOption: new InlineDatum.InlineDatum({ data: campaignDatumData(datum) }) });
  const refUtxo = utxo('refscript', 0, scriptAddr, Assets.fromLovelace(20_000_000n), { scriptRef: bloc.script });
  const pledgeUtxos = Array.from({ length: n }, (_, i) =>
    utxo(`pledge-tx-${Math.floor(i / 60)}`, i % 60, scriptAddr, Assets.fromLovelace(PLEDGE_LOCK_LOVELACE), {
      datumOption: new InlineDatum.InlineDatum({ data: pledgeDatumData({ blocId, memberRefundAddress: keyAddr(i, o.enterpriseRefunds), quantity: 1n, maxUnitPrice: MAX_PLEDGE_LOVELACE }) }),
    }),
  );
  const pledges = pledgeUtxos.map((u) => (validatePledge(info, chainPledgeOf(u, policy.hash, datum.asset)) as { pledge: ValidPledge }).pledge);
  const bid: Bid = { blocId, itemHash: datum.itemHash, asset: datum.asset, unitPrice: 1_480_000n, expiry: datum.bidDeadline, providerVkey: vkeyFromSecret(sk), providerAddress: keyAddr(424242, false) };
  const batch = planSettlement(info, pledges, bid.unitPrice, { nMax: n }).batches[0]!;
  const result = await applySettle(makeTxBuilder({ chain: preprod }), {
    bloc, campaignPolicy: policy.hash, asset: datum.asset, campaignUtxo, ...(o.referenceScript ? { referenceScriptUtxo: refUtxo } : {}),
    pledgeUtxos, batch, bid, signature: signBid(sk, policy.hash, bid), validTo: datum.bidDeadline - 1_000n,
  }).build({
    changeAddress: Address.fromBech32(admin),
    availableUtxos: [utxo('wallet-a', 0, admin, Assets.fromLovelace(60_000_000n)), utxo('wallet-b', 0, admin, Assets.fromLovelace(15_000_000n))],
    fullProtocolParameters: PREPROD_PARAMS, evaluator: measuredEvaluator,
  });
  const tx = await result.toTransactionWithFakeWitnesses();
  const size = Transaction.toCBORBytes(tx).length;
  const rs = tx.witnessSet.redeemers?.toArray() ?? [];
  const mem = rs.reduce((s, r) => s + r.exUnits.mem, 0n);
  const cpu = rs.reduce((s, r) => s + r.exUnits.steps, 0n);
  return { n, size, fee: tx.body.fee, mem, cpu, fits: size <= LIMITS.maxTxSize && mem <= LIMITS.maxTxExMem && cpu <= LIMITS.maxTxExSteps };
}
