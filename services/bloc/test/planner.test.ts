import { describe, expect, it } from 'vitest';
import { Data, pledgeDatumData } from '@overpaid/bloc-contract';
import { chainPledgeOf } from '../src/txs.js';
import { chooseBestBid, chunkEven, compareOutRef, planRefunds, planSettlement, refKey, validatePledge, type ValidPledge } from '../src/planner.js';
import { BLOC_ID, CAMPAIGN, NOW, POLICY, campaignUtxo, hexOf, keyAddr, pledgeUtxo, bidFor } from './fixtures.js';

const valid = (n: number, lovelace?: bigint, max?: bigint): ValidPledge => {
  const r = validatePledge(CAMPAIGN, chainPledgeOf(pledgeUtxo(n, lovelace, max), POLICY.hash, CAMPAIGN.asset));
  if (!r.ok) throw new Error(r.reason);
  return r.pledge;
};

describe('validatePledge (datum + locked value)', () => {
  it('accepts a well-formed funded pledge', () => {
    const p = valid(1);
    expect(p.locked).toBe(4_500_000n);
    expect(p.datum.maxUnitPrice).toBe(3_000_000n);
    expect(p.datum.memberRefundAddress).toEqual(keyAddr(2));
  });
  it('rejects missing / malformed datums, other blocs, unfunded pledges and the campaign UTxO', () => {
    const base = chainPledgeOf(pledgeUtxo(1), POLICY.hash, CAMPAIGN.asset);
    expect(validatePledge(CAMPAIGN, { ...base, datum: null })).toMatchObject({ ok: false, reason: 'no inline datum' });
    expect(validatePledge(CAMPAIGN, { ...base, datum: Data.int(5n) })).toMatchObject({ ok: false });
    expect(validatePledge(CAMPAIGN, { ...base, datum: Data.constr(0n, [Data.bytearray(BLOC_ID)]) })).toMatchObject({ ok: false });
    const other = chainPledgeOf(pledgeUtxo(2, 4_500_000n, 3_000_000n, hexOf('other-bloc')), POLICY.hash, CAMPAIGN.asset);
    expect(validatePledge(CAMPAIGN, other)).toMatchObject({ ok: false, reason: 'datum bloc_id is for another bloc' });
    const unfunded = chainPledgeOf(pledgeUtxo(3, 2_000_000n, 3_000_000n), POLICY.hash, CAMPAIGN.asset);
    expect(validatePledge(CAMPAIGN, unfunded)).toMatchObject({ ok: false });
    expect((validatePledge(CAMPAIGN, unfunded) as { reason: string }).reason).toMatch(/unfunded/);
    const zeroQ = { ...base, datum: pledgeDatumData({ blocId: BLOC_ID, memberRefundAddress: keyAddr(1), quantity: 0n, maxUnitPrice: 1n }) };
    expect(validatePledge(CAMPAIGN, zeroQ)).toMatchObject({ ok: false, reason: 'quantity must be > 0' });
    const camp = chainPledgeOf(campaignUtxo(), POLICY.hash, CAMPAIGN.asset);
    expect(validatePledge(CAMPAIGN, camp)).toMatchObject({ ok: false, reason: 'holds a campaign token (campaign UTxO)' });
  });
});

describe('chooseBestBid', () => {
  it('picks the lowest valid, unexpired bid; ties go to the earliest', () => {
    const mk = (id: string, i: number, price: bigint, valid: boolean, at: number, expiry?: bigint) => ({ id, valid, at, ...bidFor(i, price, expiry ? { expiry } : {}) });
    const bids = [
      mk('a', 0, 1_600_000n, true, 1),
      mk('b', 1, 1_400_000n, false, 2), // invalid
      mk('c', 2, 1_500_000n, true, 5),
      mk('d', 0, 1_500_000n, true, 3),
      mk('e', 1, 1_000_000n, true, 4, NOW + 1_000n), // about to expire
    ];
    expect(chooseBestBid(bids, CAMPAIGN, NOW)?.id).toBe('d');
    expect(chooseBestBid([], CAMPAIGN, NOW)).toBeNull();
    expect(chooseBestBid(bids, CAMPAIGN, CAMPAIGN.bidDeadline)).toBeNull();
  });
});

describe('planSettlement', () => {
  it('chunks evenly into batches of at most N_max in ledger input order', () => {
    expect(chunkEven([...Array(81).keys()], 40).map((c) => c.length)).toEqual([27, 27, 27]);
    expect(chunkEven([...Array(80).keys()], 40).map((c) => c.length)).toEqual([40, 40]);
    expect(chunkEven([], 40)).toEqual([]);
    const pledges = Array.from({ length: 95 }, (_, i) => valid(i));
    const plan = planSettlement(CAMPAIGN, pledges, 1_500_000n, { nMax: 40 });
    expect(plan.batches.map((b) => b.pledges.length)).toEqual([32, 32, 31]);
    expect(plan.skipped).toEqual([]);
    const all = plan.batches.flatMap((b) => b.pledges);
    expect(new Set(all.map((p) => refKey(p.ref))).size).toBe(95);
    for (const b of plan.batches) for (let k = 1; k < b.pledges.length; k++) expect(compareOutRef(b.pledges[k - 1]!.ref, b.pledges[k]!.ref)).toBeLessThan(0);
  });
  it('computes provider total and refunds with settlementAmounts (ADA asset)', () => {
    const plan = planSettlement(CAMPAIGN, [valid(1), valid(2), valid(3)], 1_500_000n, { nMax: 40 });
    const b = plan.batches[0]!;
    expect(b.providerTotal).toBe(4_500_000n);
    expect(b.refunds.map((r) => r.lovelace)).toEqual([3_000_000n, 3_000_000n, 3_000_000n]);
    expect(b.refunds.every((r, k) => refKey(r.ref) === refKey(b.pledges[k]!.ref))).toBe(true);
    expect(b.refunds.reduce((s, r) => s + r.lovelace + r.paid, 0n)).toBe(13_500_000n);
  });
  it('skips invalid pledges instead of failing the batch', () => {
    const cheap = valid(10, 4_500_000n, 1_000_000n); // max price below the bid
    const thin = valid(11, 3_100_000n, 3_000_000n); // refund would be 0.1 tADA < min-UTxO
    const dup = valid(1);
    const plan = planSettlement(CAMPAIGN, [valid(1), cheap, thin, dup, valid(2)], 3_000_000n, { nMax: 40 });
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.pledges).toHaveLength(2);
    expect(plan.skipped.map((s) => refKey(s.ref)).sort()).toEqual([refKey(cheap.ref), refKey(thin.ref)].sort());
  });
  it('respects min_batch', () => {
    const plan = planSettlement({ ...CAMPAIGN, minBatch: 5n }, [valid(1), valid(2)], 1_500_000n, { nMax: 40 });
    expect(plan.batches).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
  });
  it('refund planning only after the refund deadline', () => {
    expect(() => planRefunds([valid(1)], CAMPAIGN.refundDeadline, CAMPAIGN, 40)).toThrow(/refund deadline/);
    expect(planRefunds([valid(1), valid(2)], CAMPAIGN.refundDeadline + 1n, CAMPAIGN, 40)).toHaveLength(1);
  });
});
