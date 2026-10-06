import { describe, expect, it } from 'vitest';
import { Address, Assets, Data, InlineDatum, TransactionHash, preprod } from '@evolution-sdk/evolution';
import { makeTxBuilder } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import { outRefData, toAikenCbor } from '@overpaid/bloc-contract';
import { planSettlement, refKey, validatePledge, type ValidPledge } from '../src/planner.js';
import { applyRefund, applySettle, chainPledgeOf } from '../src/txs.js';
import { PREPROD_PARAMS, measuredEvaluator } from '../src/offline.js';
import { ADMIN, BLOC, BLOC_ADDRESS, CAMPAIGN, NOW, POLICY, bidFor, campaignUtxo, pledgeUtxo, walletUtxo, bech, PROVIDER_ADDR } from './fixtures.js';

const opts = () => ({ changeAddress: Address.fromBech32(ADMIN), availableUtxos: [walletUtxo(1, 50_000_000n), walletUtxo(2, 20_000_000n)], fullProtocolParameters: PREPROD_PARAMS, evaluator: measuredEvaluator });
const datumOf = (o: unknown) => ((o as { datumOption?: unknown }).datumOption as InlineDatum.InlineDatum).data;

describe('settle tx (offline Evolution build)', () => {
  it('provider #0, refunds #1.. in input order with out-ref datums, withdraw-zero with increasing pairs, change last', async () => {
    const utxos = [5, 1, 9, 3].map((n) => pledgeUtxo(n));
    const pledges = utxos.map((u) => (validatePledge(CAMPAIGN, chainPledgeOf(u, POLICY.hash, CAMPAIGN.asset)) as { pledge: ValidPledge }).pledge);
    const { bid, signature } = bidFor(0, 1_500_000n);
    const batch = planSettlement(CAMPAIGN, pledges, bid.unitPrice, { nMax: 40 }).batches[0]!;
    const built = await applySettle(makeTxBuilder({ chain: preprod }), {
      bloc: BLOC, campaignPolicy: POLICY.hash, asset: CAMPAIGN.asset, campaignUtxo: campaignUtxo(), pledgeUtxos: utxos,
      batch, bid, signature, validTo: NOW + 600_000n,
    }).build(opts());
    const tx = await built.toTransaction();
    const b = tx.body;
    const inputs = b.inputs.map((i) => `${TransactionHash.toHex(i.transactionId)}#${i.index}`);
    // outputs
    expect(Address.toBech32(b.outputs[0]!.address)).toBe(bech(PROVIDER_ADDR));
    expect(Assets.lovelaceOf(b.outputs[0]!.assets)).toBe(6_000_000n);
    expect(toAikenCbor(datumOf(b.outputs[0]))).toBe(toAikenCbor(Data.bytearray(POLICY.hash)));
    batch.pledges.forEach((p, k) => {
      const o = b.outputs[k + 1]!;
      expect(toAikenCbor(datumOf(o))).toBe(toAikenCbor(outRefData(p.ref)));
      expect(Assets.lovelaceOf(o.assets)).toBe(3_000_000n);
    });
    expect(b.outputs).toHaveLength(batch.pledges.length + 2);
    expect(Address.toBech32(b.outputs.at(-1)!.address)).toBe(ADMIN);
    // reference input = campaign, withdrawal of 0
    expect(b.referenceInputs?.map((i) => TransactionHash.toHex(i.transactionId))).toContain(TransactionHash.toHex(campaignUtxo().transactionId));
    // redeemers
    const rs = tx.witnessSet.redeemers!.toArray();
    const reward = rs.find((r) => r.tag === 'reward')!;
    const pairs = [...((reward.data as Data.Constr).fields[2] as Map<Data.Data, Data.Data>).entries()].map(([i, o]) => [Number(i), Number(o)]);
    expect(pairs.map((p) => p[1])).toEqual([1, 2, 3, 4]);
    pairs.forEach(([i], k) => expect(inputs[i!]).toBe(refKey(batch.pledges[k]!.ref)));
    for (let k = 1; k < pairs.length; k++) expect(pairs[k]![0]! > pairs[k - 1]![0]!).toBe(true);
    const spends = rs.filter((r) => r.tag === 'spend');
    expect(spends).toHaveLength(4);
    for (const s of spends) expect(Number((s.data as Data.Constr).fields[0])).toBe(Number(s.index));
    expect(b.ttl).toBeDefined();
  });

  it('refund tx: whole value back with the out-ref datum, Refund{input, output} redeemers, validFrom set', async () => {
    const utxos = [2, 7].map((n) => pledgeUtxo(n));
    const pledges = utxos.map((u) => ({ utxo: u, pledge: (validatePledge(CAMPAIGN, chainPledgeOf(u, POLICY.hash, CAMPAIGN.asset)) as { pledge: ValidPledge }).pledge }));
    const tx = await (await applyRefund(makeTxBuilder({ chain: preprod }), {
      bloc: BLOC, campaignUtxo: campaignUtxo(), pledges, validFrom: CAMPAIGN.refundDeadline + 2_000n, validTo: CAMPAIGN.refundDeadline + 600_000n,
    }).build(opts())).toTransaction();
    const outs = tx.body.outputs;
    pledges.forEach((p, k) => {
      expect(Assets.lovelaceOf(outs[k]!.assets)).toBe(4_500_000n);
      expect(toAikenCbor(datumOf(outs[k]))).toBe(toAikenCbor(outRefData(p.pledge.ref)));
    });
    const spends = tx.witnessSet.redeemers!.toArray().filter((r) => r.tag === 'spend');
    for (const s of spends) {
      const f = (s.data as Data.Constr);
      expect(f.index).toBe(1n);
      expect(Number(f.fields[0])).toBe(Number(s.index));
    }
    expect(tx.body.validityIntervalStart).toBeDefined();
    expect(BLOC_ADDRESS.startsWith('addr_test1w')).toBe(true);
  });
});

describe('capacity', () => {
  it('a 40-pledge settlement fits preprod limits with headroom', async () => {
    const { measureSettlement } = await import('../src/capacity.js');
    const r = await measureSettlement(40, { referenceScript: false, enterpriseRefunds: false });
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThan(16_384);
    expect(Number(r.mem)).toBeLessThan(17_500_000 * 0.75);
  });
});
