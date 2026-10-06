import { beforeAll, describe, expect, it } from 'vitest';
import { Address, Assets, Data, Effect, InlineDatum, Redeemer, TransactionHash, UTxO, preprod, type Transaction } from '@evolution-sdk/evolution';
import { makeTxBuilder } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import { ESCROW_ADDRESS, COOLDOWN_MS } from '../src/constants.js';
import { decodeEscrowDatum, EscrowState, outputReferenceData } from '../src/escrow/datum.js';
import {
  EscrowRuleError, planAuthorizeRefund, planSetRefundRequested, planSubmitResult, planWithdraw, planWithdrawRefund, toEscrowUtxo,
  type EscrowTxPlan, type EscrowUtxo,
} from '../src/escrow/plan.js';
import { buildPlan } from '../src/escrow/build.js';
import { ceilToSlotMs, ledgerBounds, msToSlot } from '../src/escrow/time.js';
import { buyerAddr, escrowUtxo, lockFixture, PROTOCOL_PARAMS, sellerAddr, txHash, vkhOf, walletUtxo } from './fixtures.js';

const SELLER = vkhOf(sellerAddr);
const BUYER = vkhOf(buyerAddr);
const HASH = 'ab'.repeat(32);
let lock0: EscrowUtxo;
let d0: ReturnType<typeof decodeEscrowDatum> & object;
/** A 1 tADA hire: below min-UTxO, so the lock carries collateral_return_lovelace > 0 that Withdraw must return. */
let lockC: EscrowUtxo;

beforeAll(async () => {
  const { lock } = await lockFixture();
  lock0 = toEscrowUtxo(escrowUtxo(lock.datum.data, lock.lockedLovelace));
  d0 = lock0.datum;
  const c = await lockFixture(1_000_000n);
  lockC = toEscrowUtxo(escrowUtxo(c.lock.datum.data, c.lock.lockedLovelace, 2));
});

let n = 50;
/** The UTxO the continuation output of `p` would create. */
function next(p: EscrowTxPlan): EscrowUtxo {
  const o = p.outputs.find((x) => x.role === 'continuation')!;
  return toEscrowUtxo(new UTxO.UTxO({
    transactionId: TransactionHash.fromHex(txHash(n++)), index: 0n, address: o.address, assets: o.assets,
    datumOption: new InlineDatum.InlineDatum({ data: o.datum }),
  }));
}

const tipAfterLock = () => d0.payByTime - 60_000n;

describe('SubmitResult (seller)', () => {
  it('FundsLocked -> ResultSubmitted; only hash, cooldowns, state change; window before submit_result_time', () => {
    const tip = tipAfterLock();
    const p = planSubmitResult(lock0, SELLER, HASH, tip);
    expect(p.toState).toBe(EscrowState.ResultSubmitted);
    expect(p.signerVkh).toBe(SELLER);
    const nd = p.newDatum!;
    expect(nd).toEqual({ ...d0, resultHash: HASH, sellerCooldownTime: nd.sellerCooldownTime, buyerCooldownTime: 0n, state: 1n });
    const { lower, upper } = ledgerBounds(p.validity);
    expect(lower >= d0.sellerCooldownTime).toBe(true);
    expect(upper < d0.submitResultTime).toBe(true);
    expect(nd.sellerCooldownTime >= upper + COOLDOWN_MS).toBe(true);
    const cont = p.outputs.filter((o) => o.role === 'continuation');
    expect(cont).toHaveLength(1);
    expect(Address.toBech32(cont[0]!.address)).toBe(ESCROW_ADDRESS);
    expect(Assets.lovelaceOf(cont[0]!.assets)).toBe(lock0.lovelace);
  });
  it('refuses a non-seller signer, a malformed hash, and a closed window', () => {
    expect(() => planSubmitResult(lock0, BUYER, HASH, tipAfterLock())).toThrow(/signer is not the datum seller/);
    expect(() => planSubmitResult(lock0, SELLER, 'xyz', tipAfterLock())).toThrow(/64 lowercase hex/);
    expect(() => planSubmitResult(lock0, SELLER, HASH, d0.submitResultTime - 60_000n)).toThrow(EscrowRuleError);
  });
  it('RefundRequested -> Disputed', () => {
    const rr = next(planSetRefundRequested(lock0, BUYER, tipAfterLock()));
    expect(rr.datum.state).toBe(EscrowState.RefundRequested);
    const p = planSubmitResult(rr, SELLER, HASH, tipAfterLock() + 30_000n);
    expect(p.toState).toBe(EscrowState.Disputed);
    expect(p.newDatum!.buyerCooldownTime).toBe(0n);
  });
  it('respects its own cooldown when rotating the hash', () => {
    const rs = next(planSubmitResult(lock0, SELLER, HASH, tipAfterLock()));
    expect(() => planSubmitResult(rs, SELLER, 'cd'.repeat(32), tipAfterLock() + 60_000n)).toThrow(/not valid before/);
  });
});

describe('Withdraw (seller collects)', () => {
  it('ResultSubmitted before unlock_time is refused with the retry time', () => {
    const rs = next(planSubmitResult(lock0, SELLER, HASH, tipAfterLock()));
    try {
      planWithdraw(rs, SELLER, d0.unlockTime - 1_000n);
      expect.unreachable();
    } catch (e) {
      expect((e as EscrowRuleError).notBefore).toBe(ceilToSlotMs(d0.unlockTime));
    }
  });
  it('5 tADA hire: collateral_return_lovelace is 0, so no buyer output is required', () => {
    expect(d0.collateralReturnLovelace).toBe(0n);
    const rs = next(planSubmitResult(lock0, SELLER, HASH, tipAfterLock()));
    expect(planWithdraw(rs, SELLER, d0.unlockTime + 5_000n).outputs).toHaveLength(0);
  });
  it('after unlock_time: terminal, lower >= unlock, buyer collateral tagged with the spent OutputReference', () => {
    expect(lockC.datum.collateralReturnLovelace >= 1_435_230n).toBe(true);
    const rs = next(planSubmitResult(lockC, SELLER, HASH, tipAfterLock()));
    const p = planWithdraw(rs, SELLER, d0.unlockTime + 5_000n);
    expect(p.toState).toBeNull();
    expect(ledgerBounds(p.validity).lower >= d0.unlockTime).toBe(true);
    expect(p.outputs.some((o) => Address.toBech32(o.address) === ESCROW_ADDRESS)).toBe(false);
    const col = p.outputs.find((o) => o.role === 'buyer-collateral')!;
    expect(Address.toBech32(col.address)).toBe(buyerAddr);
    expect(Assets.lovelaceOf(col.assets)).toBe(lockC.datum.collateralReturnLovelace);
    expect(Data.toCBORHex(col.datum)).toBe(Data.toCBORHex(outputReferenceData(rs.txHash, rs.outputIndex)));
  });
  it('refuses with no result, from FundsLocked, or for the buyer', () => {
    expect(() => planWithdraw(lock0, SELLER, d0.unlockTime + 5_000n)).toThrow(/no result submitted/);
    const rs = next(planSubmitResult(lock0, SELLER, HASH, tipAfterLock()));
    expect(() => planWithdraw(rs, BUYER, d0.unlockTime + 5_000n)).toThrow(/signer/);
  });
});

describe('Refund path (a): no result', () => {
  it('SetRefundRequested (buyer, before unlock) -> RefundRequested; WithdrawRefund after submit_result_time', () => {
    const p1 = planSetRefundRequested(lock0, BUYER, tipAfterLock());
    expect(p1.toState).toBe(EscrowState.RefundRequested);
    expect(p1.newDatum!.sellerCooldownTime).toBe(0n);
    expect(p1.newDatum!.buyerCooldownTime >= ledgerBounds(p1.validity).upper + COOLDOWN_MS).toBe(true);
    expect(ledgerBounds(p1.validity).upper < d0.unlockTime).toBe(true);
    const rr = next(p1);
    expect(() => planWithdrawRefund(rr, BUYER, d0.submitResultTime - 1_000n)).toThrow(/not valid before/);
    const p2 = planWithdrawRefund(rr, BUYER, d0.submitResultTime + 1_000n);
    expect(p2.toState).toBeNull();
    expect(ledgerBounds(p2.validity).lower >= d0.submitResultTime).toBe(true);
    expect(p2.outputs).toHaveLength(0); // buyer_return_address None: full value returns as change to the buyer
  });
  it('WithdrawRefund straight from FundsLocked after submit_result_time also works', () => {
    expect(planWithdrawRefund(lock0, BUYER, d0.submitResultTime + 1_000n).toState).toBeNull();
  });
  it('SetRefundRequested at/after unlock_time is refused', () => {
    expect(() => planSetRefundRequested(lock0, BUYER, d0.unlockTime + 1_000n)).toThrow(EscrowRuleError);
  });
});

describe('Refund path (b): result, then dispute', () => {
  it('RS -SetRefundRequested-> Disputed -AuthorizeRefund-> RefundAuthorized -WithdrawRefund-> closed', () => {
    const rs = next(planSubmitResult(lock0, SELLER, HASH, tipAfterLock()));
    expect(() => planWithdrawRefund(rs, BUYER, d0.submitResultTime + 1_000n)).toThrow(/result hash is set/);
    const pD = planSetRefundRequested(rs, BUYER, tipAfterLock() + 30_000n);
    expect(pD.toState).toBe(EscrowState.Disputed);
    expect(pD.newDatum!.resultHash).toBe(HASH);
    const dis = next(pD);
    // seller cooldown was reset to 0 by the buyer's action -> seller may act immediately
    const pRA = planAuthorizeRefund(dis, SELLER, tipAfterLock() + 60_000n);
    expect(pRA.toState).toBe(EscrowState.RefundAuthorized);
    expect(pRA.newDatum!.resultHash).toBe('');
    expect(pRA.newDatum!.buyerCooldownTime).toBe(0n);
    const ra = next(pRA);
    // RefundAuthorized: no time gate (even before submit_result_time)
    const pW = planWithdrawRefund(ra, BUYER, tipAfterLock() + 90_000n);
    expect(pW.toState).toBeNull();
    // and the seller cannot collect any more
    expect(() => planWithdraw(ra, SELLER, d0.unlockTime + 5_000n)).toThrow(EscrowRuleError);
  });
});

// ---------------------------------------------------------------- offline Evolution builds

const evaluator = {
  evaluate: (tx: Transaction.Transaction) => {
    void tx;
    return Effect.succeed([{ ex_units: new Redeemer.ExUnits({ mem: 2_000_000n, steps: 800_000_000n }), redeemer_index: 0, redeemer_tag: 'spend' as const }]);
  },
};

async function build(p: EscrowTxPlan, actor: string, n: number) {
  const r = await buildPlan(makeTxBuilder({ chain: preprod }), p, {
    changeAddress: Address.fromBech32(actor),
    walletUtxos: [walletUtxo(actor, 30_000_000n, n), walletUtxo(actor, 6_000_000n, n + 1)],
    fullProtocolParameters: PROTOCOL_PARAMS,
    evaluator,
  });
  return r.toTransaction();
}

function checkCommon(tx: Transaction.Transaction, p: EscrowTxPlan, signer: string) {
  const b = tx.body;
  const inputs = b.inputs.map((i) => `${TransactionHash.toHex(i.transactionId)}#${i.index}`);
  expect(inputs).toContain(`${p.input.txHash}#${p.input.outputIndex}`);
  expect(b.requiredSigners!.map((k) => Buffer.from((k as unknown as { hash: Uint8Array }).hash).toString('hex'))).toEqual([signer]);
  expect(b.validityIntervalStart).toBe(msToSlot(p.validity.from));
  expect(b.ttl).toBe(msToSlot(p.validity.to)); // finite upper bound
  expect(b.collateralInputs?.length ?? 0).toBeGreaterThan(0);
  expect(b.scriptDataHash).toBeDefined();
  const scriptOuts = b.outputs.filter((o) => Address.toBech32(o.address) === ESCROW_ADDRESS);
  return scriptOuts;
}

describe('offline tx builds (fixture UTxOs + fixed protocol params + stub evaluator)', () => {
  it('SubmitResult: exactly one continuation at the escrow with the planned inline datum', async () => {
    const p = planSubmitResult(lock0, SELLER, HASH, tipAfterLock());
    const tx = await build(p, sellerAddr, 200);
    const outs = checkCommon(tx, p, SELLER);
    expect(outs).toHaveLength(1);
    const dat = (outs[0] as unknown as { datumOption: InlineDatum.InlineDatum }).datumOption;
    expect(Data.toCBORHex(dat.data)).toBe(Data.toCBORHex(p.outputs[0]!.datum));
    expect(Assets.lovelaceOf(outs[0]!.assets) >= lock0.lovelace).toBe(true);
    expect((outs[0] as unknown as { scriptRef?: unknown }).scriptRef).toBeUndefined();
  });
  it('Withdraw: no escrow output, tagged buyer collateral output present', async () => {
    const rs = next(planSubmitResult(lockC, SELLER, HASH, tipAfterLock()));
    const p = planWithdraw(rs, SELLER, d0.unlockTime + 5_000n);
    const tx = await build(p, sellerAddr, 210);
    expect(checkCommon(tx, p, SELLER)).toHaveLength(0);
    const tag = Data.toCBORHex(outputReferenceData(rs.txHash, rs.outputIndex));
    const tagged = tx.body.outputs.filter((o) => {
      const d = (o as unknown as { datumOption?: InlineDatum.InlineDatum }).datumOption;
      return d instanceof InlineDatum.InlineDatum && Data.toCBORHex(d.data) === tag;
    });
    expect(tagged).toHaveLength(1);
    expect(Address.toBech32(tagged[0]!.address)).toBe(buyerAddr);
    expect(Assets.lovelaceOf(tagged[0]!.assets) >= lockC.datum.collateralReturnLovelace).toBe(true);
  });
  it('SetRefundRequested / AuthorizeRefund / WithdrawRefund build with the right signer', async () => {
    const pRR = planSetRefundRequested(lock0, BUYER, tipAfterLock());
    expect(checkCommon(await build(pRR, buyerAddr, 220), pRR, BUYER)).toHaveLength(1);
    const pRA = planAuthorizeRefund(next(pRR), SELLER, tipAfterLock() + 30_000n);
    expect(checkCommon(await build(pRA, sellerAddr, 230), pRA, SELLER)).toHaveLength(1);
    const pW = planWithdrawRefund(next(pRA), BUYER, tipAfterLock() + 60_000n);
    expect(checkCommon(await build(pW, buyerAddr, 240), pW, BUYER)).toHaveLength(0);
  });
  it('refuses to build with an empty wallet', async () => {
    const p = planSubmitResult(lock0, SELLER, HASH, tipAfterLock());
    await expect(buildPlan(makeTxBuilder({ chain: preprod }), p, { changeAddress: Address.fromBech32(sellerAddr), walletUtxos: [], fullProtocolParameters: PROTOCOL_PARAMS, evaluator })).rejects.toThrow(/no spendable UTxO/);
  });
  it('escrow UTxOs are never used for fees/collateral even if passed as wallet UTxOs', async () => {
    const p = planSubmitResult(lock0, SELLER, HASH, tipAfterLock());
    const decoy = escrowUtxo(lock0.datumData, 50_000_000n, 99);
    const r = await buildPlan(makeTxBuilder({ chain: preprod }), p, {
      changeAddress: Address.fromBech32(sellerAddr), walletUtxos: [decoy, walletUtxo(sellerAddr, 30_000_000n, 250)], fullProtocolParameters: PROTOCOL_PARAMS, evaluator,
    });
    const tx = await r.toTransaction();
    const ins = [...tx.body.inputs, ...(tx.body.collateralInputs ?? [])].map((i) => TransactionHash.toHex(i.transactionId));
    expect(ins).not.toContain(txHash(99));
  });
});
