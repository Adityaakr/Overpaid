/**
 * vested_pay v2 datum (Constr 0, 19 fields) and redeemers (docs/research/vested-pay-v2.md §3-4).
 * Decoding reuses @x402/cardano's parseMasumiLockDatum. Encoding of a full view is ported here (x402 only builds a
 * fresh FundsLocked datum); continuation datums are produced by editing the ON-CHAIN Data in place so every other
 * field keeps its exact structure (research §9.3: equality is on Plutus data).
 */
import { Data } from '@evolution-sdk/evolution';
import { parseMasumiLockDatum, type MasumiAddressCredentials, type MasumiDatumView } from '@x402/cardano';

export type EscrowDatum = MasumiDatumView;

export const EscrowState = {
  FundsLocked: 0n,
  ResultSubmitted: 1n,
  RefundRequested: 2n,
  Disputed: 3n,
  WithdrawAuthorized: 4n,
  RefundAuthorized: 5n,
} as const;
export type EscrowStateName = keyof typeof EscrowState;
export const stateName = (s: bigint): EscrowStateName | `Unknown(${string})` =>
  (Object.entries(EscrowState).find(([, v]) => v === s)?.[0] as EscrowStateName | undefined) ?? `Unknown(${s})`;

/** Action constructor indices (VP:75-94). All five we build carry no fields. */
export const Redeemer = {
  Withdraw: 0n,
  SetRefundRequested: 1n,
  AuthorizeWithdrawal: 2n,
  WithdrawRefund: 3n,
  WithdrawDisputed: 4n,
  SubmitResult: 5n,
  AuthorizeRefund: 6n,
} as const;
export type RedeemerName = keyof typeof Redeemer;
export const redeemerData = (name: RedeemerName): Data.Data => Data.constr(Redeemer[name], []);

export const FIELD = {
  buyer: 0, buyerReturnAddress: 1, seller: 2, sellerReturnAddress: 3, referenceKey: 4, referenceSignature: 5,
  sellerNonce: 6, buyerNonce: 7, agentIdentifier: 8, collateralReturnLovelace: 9, inputHash: 10, resultHash: 11,
  payByTime: 12, submitResultTime: 13, unlockTime: 14, externalDisputeUnlockTime: 15, sellerCooldownTime: 16,
  buyerCooldownTime: 17, state: 18,
} as const;

export function decodeEscrowDatum(d: Data.Data | string): EscrowDatum | null {
  return parseMasumiLockDatum(d);
}

// ---- full encoder (port of the x402 address encoders, generalised to any state) ----
const credData = (c: { isScript: boolean; hash: string }) => Data.constr(c.isScript ? 1n : 0n, [Data.bytearray(c.hash)]);
export function addressData(a: MasumiAddressCredentials): Data.Data {
  const stake = a.stake
    ? Data.constr(0n, [Data.constr(0n, [credData(a.stake)])])
    : a.pointer
      ? Data.constr(0n, [Data.constr(1n, [Data.int(a.pointer.slot), Data.int(a.pointer.txIndex), Data.int(a.pointer.certIndex)])])
      : Data.constr(1n, []);
  return Data.constr(0n, [credData(a.payment), stake]);
}
const optAddressData = (a: MasumiAddressCredentials | null) => (a ? Data.constr(0n, [addressData(a)]) : Data.constr(1n, []));

export function encodeEscrowDatum(v: EscrowDatum): Data.Data {
  return Data.constr(0n, [
    addressData(v.buyer),
    optAddressData(v.buyerReturnAddress),
    addressData(v.seller),
    optAddressData(v.sellerReturnAddress),
    Data.bytearray(v.referenceKey),
    Data.bytearray(v.referenceSignature),
    Data.bytearray(v.sellerNonce),
    Data.bytearray(v.buyerNonce),
    Data.bytearray(v.agentIdentifier),
    Data.int(v.collateralReturnLovelace),
    Data.bytearray(v.inputHash),
    Data.bytearray(v.resultHash),
    Data.int(v.payByTime),
    Data.int(v.submitResultTime),
    Data.int(v.unlockTime),
    Data.int(v.externalDisputeUnlockTime),
    Data.int(v.sellerCooldownTime),
    Data.int(v.buyerCooldownTime),
    Data.constr(v.state, []),
  ]);
}

/** Continuation edits allowed by the validator: only these fields ever change in a continuing output. */
export interface DatumEdit {
  resultHash?: string;
  sellerCooldownTime?: bigint;
  buyerCooldownTime?: bigint;
  state?: bigint;
}

/** Copy the on-chain datum and replace only the edited fields (structure-preserving). */
export function editDatum(onChain: Data.Data, edit: DatumEdit): Data.Data {
  if (!Data.isConstr(onChain) || onChain.index !== 0n || onChain.fields.length !== 19) throw new Error('not a vested_pay datum');
  const f = [...onChain.fields];
  if (edit.resultHash !== undefined) f[FIELD.resultHash] = Data.bytearray(edit.resultHash);
  if (edit.sellerCooldownTime !== undefined) f[FIELD.sellerCooldownTime] = Data.int(edit.sellerCooldownTime);
  if (edit.buyerCooldownTime !== undefined) f[FIELD.buyerCooldownTime] = Data.int(edit.buyerCooldownTime);
  if (edit.state !== undefined) f[FIELD.state] = Data.constr(edit.state, []);
  return Data.constr(0n, f);
}

/** Plutus V3 OutputReference { transaction_id, output_index } = Constr 0 [bytes32, int] — the payout tag. */
export const outputReferenceData = (txHash: string, index: bigint | number) =>
  Data.constr(0n, [Data.bytearray(txHash), Data.int(BigInt(index))]);

/** Result hashes are 32-byte hex (SHA-256). The validator only needs non-empty; we are stricter. */
export function assertResultHash(h: string): void {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('result hash must be 64 lowercase hex chars (SHA-256)');
}
