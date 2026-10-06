/**
 * Pure planners for the five vested_pay v2 transactions we build (docs/research/vested-pay-v2.md §4, §6, §8).
 * A plan states exactly what the tx must contain; build.ts turns it into an Evolution tx. Every validator
 * condition we can check off chain is checked here, so a bad request fails before any fee is spent.
 */
import { Address, Assets, Data, InlineDatum, KeyHash, ScriptHash, TransactionHash, type UTxO } from '@evolution-sdk/evolution';
import type { MasumiAddressCredentials } from '@x402/cardano';
import { COOLDOWN_MS, ESCROW_ADDRESS } from '../constants.js';
import {
  decodeEscrowDatum, editDatum, EscrowState, outputReferenceData, redeemerData, stateName, assertResultHash,
  type EscrowDatum, type RedeemerName,
} from './datum.js';
import { computeWindow, cooldownAfter, DEADLINE_MARGIN_MS, MIN_LANDING_MS, type Window } from './time.js';

export type EscrowAction = 'SubmitResult' | 'Withdraw' | 'SetRefundRequested' | 'WithdrawRefund' | 'AuthorizeRefund';

export class EscrowRuleError extends Error {
  constructor(readonly action: EscrowAction, message: string, readonly notBefore?: bigint) {
    super(`${action}: ${message}`);
    this.name = 'EscrowRuleError';
  }
}

export interface EscrowUtxo {
  utxo: UTxO.UTxO;
  txHash: string;
  outputIndex: number;
  datum: EscrowDatum;
  datumData: Data.Data;
  lovelace: bigint;
}

export interface PlannedOutput {
  address: Address.Address;
  assets: Assets.Assets;
  datum: Data.Data;
  /** Continuation outputs may grow for min-UTxO; payouts are exact unless noted. */
  autoMinUtxo: boolean;
  role: 'continuation' | 'buyer-collateral' | 'seller-payout' | 'buyer-refund';
}

export interface EscrowTxPlan {
  action: EscrowAction;
  input: EscrowUtxo;
  redeemer: Data.Data;
  /** Payment key hash that must be in required signers (datum buyer or seller). */
  signerVkh: string;
  validity: Window;
  outputs: PlannedOutput[];
  fromState: bigint;
  /** Resulting state; null for terminal (funds leave the escrow). */
  toState: bigint | null;
  newDatum?: EscrowDatum;
}

/** Decode an Evolution UTxO at the escrow into an EscrowUtxo, or explain why it is not one. */
export function toEscrowUtxo(utxo: UTxO.UTxO): EscrowUtxo {
  if (Address.toBech32(utxo.address) !== ESCROW_ADDRESS) throw new Error('UTxO is not at the vested_pay escrow address');
  if (utxo.scriptRef !== undefined) throw new Error('escrow UTxO carries a reference script');
  if (!(utxo.datumOption instanceof InlineDatum.InlineDatum)) throw new Error('escrow UTxO has no inline datum');
  const datum = decodeEscrowDatum(utxo.datumOption.data);
  if (!datum) throw new Error('escrow UTxO datum is not a vested_pay v2 datum');
  return {
    utxo,
    txHash: TransactionHash.toHex(utxo.transactionId),
    outputIndex: Number(utxo.index),
    datum,
    datumData: utxo.datumOption.data,
    lovelace: Assets.lovelaceOf(utxo.assets),
  };
}

/** Datum credentials back to a ledger address. Pointer stake refs are refused (x402 refuses them at lock). */
export function credentialsToAddress(a: MasumiAddressCredentials): Address.Address {
  if (a.pointer) throw new Error('pointer addresses are not supported');
  const cred = (c: { isScript: boolean; hash: string }) => (c.isScript ? ScriptHash.fromHex(c.hash) : KeyHash.fromHex(c.hash));
  return new Address.Address({ networkId: 0, paymentCredential: cred(a.payment), ...(a.stake ? { stakingCredential: cred(a.stake) } : {}) });
}

function principalVkh(action: EscrowAction, who: 'buyer' | 'seller', d: EscrowDatum): string {
  const p = d[who].payment;
  if (p.isScript) throw new EscrowRuleError(action, `${who} must have a verification-key payment credential`);
  return p.hash;
}

function common(action: EscrowAction, e: EscrowUtxo, actorVkh: string, who: 'buyer' | 'seller'): string {
  const d = e.datum;
  if (d.collateralReturnLovelace < 0n) throw new EscrowRuleError(action, 'negative collateral_return_lovelace');
  if (d.referenceSignature.length < 32) throw new EscrowRuleError(action, 'reference_signature shorter than 16 bytes');
  if (e.lovelace < d.collateralReturnLovelace) throw new EscrowRuleError(action, 'escrow holds less lovelace than collateral_return_lovelace');
  const vkh = principalVkh(action, who, d);
  if (vkh !== actorVkh.toLowerCase()) throw new EscrowRuleError(action, `signer is not the datum ${who}`);
  return vkh;
}

function window(action: EscrowAction, tipMs: bigint, opts: Parameters<typeof computeWindow>[1]): Window {
  try {
    return computeWindow(tipMs, opts);
  } catch (err) {
    const e = err as Error & { notBefore?: bigint };
    throw new EscrowRuleError(action, e.message, e.notBefore);
  }
}

function continuation(e: EscrowUtxo, datum: Data.Data): PlannedOutput {
  // Same address (no stake part added), value >= input (identical assets, may grow for min-UTxO), no ref script.
  return { address: e.utxo.address, assets: e.utxo.assets, datum, autoMinUtxo: true, role: 'continuation' };
}

function plan(action: EscrowAction, e: EscrowUtxo, signerVkh: string, validity: Window, outputs: PlannedOutput[], toState: bigint | null, newDatumData?: Data.Data): EscrowTxPlan {
  const p: EscrowTxPlan = {
    action, input: e, redeemer: redeemerData(action as RedeemerName), signerVkh, validity, outputs, fromState: e.datum.state, toState,
  };
  if (newDatumData) {
    const nd = decodeEscrowDatum(newDatumData);
    if (!nd) throw new Error('internal: continuation datum does not decode');
    p.newDatum = nd;
  }
  return p;
}

// ---------------------------------------------------------------- seller

/** SubmitResult (5): FL/RS -> ResultSubmitted, RR/D -> Disputed. */
export function planSubmitResult(e: EscrowUtxo, sellerVkh: string, resultHash: string, tipMs: bigint): EscrowTxPlan {
  const A = 'SubmitResult';
  assertResultHash(resultHash);
  const vkh = common(A, e, sellerVkh, 'seller');
  const d = e.datum;
  const S = EscrowState;
  if (![S.FundsLocked, S.ResultSubmitted, S.RefundRequested, S.Disputed].includes(d.state as never)) {
    throw new EscrowRuleError(A, `not allowed from ${stateName(d.state)}`);
  }
  // upper < submit_result_time, or (< external_dispute_unlock_time AND a hash already exists).
  const deadline = d.resultHash !== '' && tipMs + DEADLINE_MARGIN_MS + MIN_LANDING_MS >= d.submitResultTime ? d.externalDisputeUnlockTime : d.submitResultTime;
  const w = window(A, tipMs, { notBefore: d.sellerCooldownTime, endBefore: deadline });
  const toState = d.state === S.FundsLocked || d.state === S.ResultSubmitted ? S.ResultSubmitted : S.Disputed;
  const nd = editDatum(e.datumData, { resultHash, sellerCooldownTime: cooldownAfter(w, COOLDOWN_MS), buyerCooldownTime: 0n, state: toState });
  return plan(A, e, vkh, w, [continuation(e, nd)], toState, nd);
}

/** Withdraw (0): seller collects. ResultSubmitted after unlock_time, or WithdrawAuthorized. One escrow per tx. */
export function planWithdraw(e: EscrowUtxo, sellerVkh: string, tipMs: bigint): EscrowTxPlan {
  const A = 'Withdraw';
  const vkh = common(A, e, sellerVkh, 'seller');
  const d = e.datum;
  if (d.resultHash === '') throw new EscrowRuleError(A, 'no result submitted');
  let w: Window;
  if (d.state === EscrowState.ResultSubmitted) w = window(A, tipMs, { notBefore: d.unlockTime });
  else if (d.state === EscrowState.WithdrawAuthorized) w = window(A, tipMs, {});
  else throw new EscrowRuleError(A, `not allowed from ${stateName(d.state)}`);
  const tag = outputReferenceData(e.txHash, e.outputIndex);
  const outputs: PlannedOutput[] = [];
  if (d.collateralReturnLovelace > 0n) {
    // Required even when buyer_return_address is None: tagged output at buyer_return ?? buyer, >= collateral.
    outputs.push({
      address: credentialsToAddress(d.buyerReturnAddress ?? d.buyer),
      assets: Assets.fromLovelace(d.collateralReturnLovelace),
      datum: tag, autoMinUtxo: false, role: 'buyer-collateral',
    });
  }
  if (d.sellerReturnAddress) {
    outputs.push({
      address: credentialsToAddress(d.sellerReturnAddress),
      assets: Assets.subtractLovelace(e.utxo.assets, d.collateralReturnLovelace),
      datum: tag, autoMinUtxo: false, role: 'seller-payout',
    });
  }
  // seller_return_address None: the remainder returns to the seller's wallet as change.
  return plan(A, e, vkh, w, outputs, null);
}

/** AuthorizeRefund (6): FL/RS/RR/D -> RefundAuthorized; clears result_hash. No upper deadline. */
export function planAuthorizeRefund(e: EscrowUtxo, sellerVkh: string, tipMs: bigint): EscrowTxPlan {
  const A = 'AuthorizeRefund';
  const vkh = common(A, e, sellerVkh, 'seller');
  const d = e.datum;
  const S = EscrowState;
  if (![S.FundsLocked, S.ResultSubmitted, S.RefundRequested, S.Disputed].includes(d.state as never)) {
    throw new EscrowRuleError(A, `not allowed from ${stateName(d.state)}`);
  }
  const w = window(A, tipMs, { notBefore: d.sellerCooldownTime });
  const nd = editDatum(e.datumData, { resultHash: '', sellerCooldownTime: cooldownAfter(w, COOLDOWN_MS), buyerCooldownTime: 0n, state: S.RefundAuthorized });
  return plan(A, e, vkh, w, [continuation(e, nd)], S.RefundAuthorized, nd);
}

// ---------------------------------------------------------------- buyer

/** SetRefundRequested (1): FL/RS/D -> RefundRequested (no hash) or Disputed (hash). Before unlock_time. Irreversible. */
export function planSetRefundRequested(e: EscrowUtxo, buyerVkh: string, tipMs: bigint): EscrowTxPlan {
  const A = 'SetRefundRequested';
  const vkh = common(A, e, buyerVkh, 'buyer');
  const d = e.datum;
  const S = EscrowState;
  if (![S.FundsLocked, S.ResultSubmitted, S.Disputed].includes(d.state as never)) throw new EscrowRuleError(A, `not allowed from ${stateName(d.state)}`);
  const w = window(A, tipMs, { notBefore: d.buyerCooldownTime, endBefore: d.unlockTime });
  const toState = d.resultHash === '' ? S.RefundRequested : S.Disputed;
  const nd = editDatum(e.datumData, { sellerCooldownTime: 0n, buyerCooldownTime: cooldownAfter(w, COOLDOWN_MS), state: toState });
  return plan(A, e, vkh, w, [continuation(e, nd)], toState, nd);
}

/** WithdrawRefund (3): FL/RR after submit_result_time, or RefundAuthorized anytime. Requires empty result_hash. */
export function planWithdrawRefund(e: EscrowUtxo, buyerVkh: string, tipMs: bigint): EscrowTxPlan {
  const A = 'WithdrawRefund';
  const vkh = common(A, e, buyerVkh, 'buyer');
  const d = e.datum;
  const S = EscrowState;
  if (d.resultHash !== '') throw new EscrowRuleError(A, 'a result hash is set; only AuthorizeRefund (seller) or the admins can release it');
  let w: Window;
  if (d.state === S.RefundAuthorized) w = window(A, tipMs, {});
  else if (d.state === S.FundsLocked || d.state === S.RefundRequested) w = window(A, tipMs, { notBefore: d.submitResultTime });
  else throw new EscrowRuleError(A, `not allowed from ${stateName(d.state)}`);
  const outputs: PlannedOutput[] = [];
  if (d.buyerReturnAddress) {
    outputs.push({
      address: credentialsToAddress(d.buyerReturnAddress), assets: e.utxo.assets,
      datum: outputReferenceData(e.txHash, e.outputIndex), autoMinUtxo: false, role: 'buyer-refund',
    });
  }
  // buyer_return_address None: the full value returns to the buyer's wallet as change.
  return plan(A, e, vkh, w, outputs, null);
}

export const isTerminal = (p: EscrowTxPlan) => p.toState === null;
