/**
 * @overpaid/bloc-contract: off-chain mirror of contracts/bloc (Aiken, Plutus V3).
 *
 * - loads contracts/bloc/plutus.json and applies parameters exactly like `aiken blueprint apply`
 * - computes the campaign policy id, the bloc script hash and its addresses
 * - encodes every datum / redeemer as Evolution `Data` with the same shape as the Aiken types
 * - builds the fixed-layout bid message (see contracts/bloc/README.md) and signs / verifies it
 *
 * Keep this file in lock-step with contracts/bloc/lib/bloc/types.ak and lib/bloc/message.ak.
 */
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Address, Bytes, CBOR, Credential, Data, PlutusV3, ScriptHash, UPLC } from "@evolution-sdk/evolution";

export type Hex = string;

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

export interface BlueprintValidator {
  title: string;
  compiledCode: Hex;
  hash: Hex;
  parameters?: Array<{ title: string; schema: unknown }>;
}
export interface Blueprint {
  preamble: { title: string; version: string; plutusVersion: string; compiler?: { name: string; version: string } };
  validators: BlueprintValidator[];
}

/** Default location of the compiled blueprint (`aiken build` output). */
export const DEFAULT_BLUEPRINT_PATH = new URL("../../../contracts/bloc/plutus.json", import.meta.url);

export const VALIDATOR_TITLES = {
  campaign: "campaign.campaign.mint",
  blocSpend: "bloc.bloc.spend",
  blocWithdraw: "bloc.bloc.withdraw",
  blocPublish: "bloc.bloc.publish",
} as const;

export function loadBlueprint(path: string | URL = DEFAULT_BLUEPRINT_PATH): Blueprint {
  return JSON.parse(readFileSync(path, "utf8")) as Blueprint;
}

function validator(bp: Blueprint, title: string): BlueprintValidator {
  const v = bp.validators.find((x) => x.title === title);
  if (!v) throw new Error(`validator ${title} not found in blueprint`);
  return v;
}

export interface AppliedScript {
  /** Single-CBOR-wrapped flat program, byte-identical to `aiken blueprint apply` compiledCode. */
  compiledCode: Hex;
  script: PlutusV3.PlutusV3;
  /** blake2b-224(0x03 ‖ script bytes): policy id for minting, script hash for spending / staking. */
  hash: Hex;
}

/** Apply Plutus Data parameters left-to-right (same order as successive `aiken blueprint apply` calls). */
export function applyParams(compiledCode: Hex, params: Data.Data[]): AppliedScript {
  const single = UPLC.applySingleCborEncoding(UPLC.applyParamsToScript(compiledCode, params));
  const script = new PlutusV3.PlutusV3({ bytes: Bytes.fromHex(single) });
  return { compiledCode: single, script, hash: ScriptHash.toHex(ScriptHash.fromScript(script)) };
}

/** One-shot campaign minting policy, parameterised by the seed UTxO the mint tx must spend. */
export function campaignPolicy(seed: OutRef, bp: Blueprint = loadBlueprint()): AppliedScript {
  return applyParams(validator(bp, VALIDATOR_TITLES.campaign).compiledCode, [outRefData(seed)]);
}

/** The bloc validator (spend + withdraw + publish share this one hash), parameterised by the campaign policy id. */
export function blocScript(campaignPolicyId: Hex, bp: Blueprint = loadBlueprint()): AppliedScript {
  return applyParams(validator(bp, VALIDATOR_TITLES.blocSpend).compiledCode, [Data.bytearray(campaignPolicyId)]);
}

/** Pledge (and campaign-lock) address: payment = Script(bloc hash), optional stake part. networkId 0 = preprod/testnets. */
export function blocAddress(blocHash: Hex, networkId = 0, stake?: PlutusCredential): string {
  return Address.toBech32(
    new Address.Address({
      networkId,
      paymentCredential: Credential.makeScriptHash(Bytes.fromHex(blocHash)),
      ...(stake ? { stakingCredential: toEvoCredential(stake) } : {}),
    }),
  );
}

/** Stake credential used for the withdraw-zero (register once with a Conway RegCert + publish redeemer). */
export function blocStakeCredential(blocHash: Hex): Credential.Credential {
  return Credential.makeScriptHash(Bytes.fromHex(blocHash));
}

// ---------------------------------------------------------------------------
// Plain records (mirror of lib/bloc/types.ak)
// ---------------------------------------------------------------------------

export interface OutRef {
  txHash: Hex;
  index: number | bigint;
}
export interface PlutusCredential {
  type: "key" | "script";
  hash: Hex; // 28 bytes
}
/** Plutus view of an address (no network id, no pointers). */
export interface PlutusAddress {
  payment: PlutusCredential;
  stake?: PlutusCredential;
}
export interface AssetId {
  policy: Hex; // "" for ADA
  name: Hex; // "" for ADA
}
export interface CampaignDatum {
  blocId: Hex;
  itemHash: Hex;
  asset: AssetId;
  membersLimit: bigint;
  minBatch: bigint;
  bidDeadline: bigint; // POSIX ms
  refundDeadline: bigint; // POSIX ms
  providerVkeys: Hex[]; // 32-byte ed25519 public keys
}
export interface PledgeDatum {
  blocId: Hex;
  memberRefundAddress: PlutusAddress;
  quantity: bigint;
  maxUnitPrice: bigint;
}
export interface Bid {
  blocId: Hex;
  itemHash: Hex;
  asset: AssetId;
  unitPrice: bigint;
  expiry: bigint; // POSIX ms
  providerVkey: Hex; // 32 bytes
  providerAddress: PlutusAddress;
}

// ---------------------------------------------------------------------------
// Data encoders (Aiken constructor order, Plutus V3 ledger encodings)
// ---------------------------------------------------------------------------

const int = (n: number | bigint) => Data.int(BigInt(n));
const bytes = (h: Hex) => Data.bytearray(h.toLowerCase());

/** OutputReference { transaction_id, output_index } = Constr 0 [B, I]. Also the refund-output datum. */
export function outRefData(r: OutRef): Data.Data {
  return Data.constr(0n, [bytes(r.txHash), int(r.index)]);
}
/** Credential: VerificationKey = Constr 0 [B], Script = Constr 1 [B]. */
export function credentialData(c: PlutusCredential): Data.Data {
  return Data.constr(c.type === "key" ? 0n : 1n, [bytes(c.hash)]);
}
/** Address { payment_credential, stake_credential: Option<Inline(Credential)> }. */
export function addressData(a: PlutusAddress): Data.Data {
  const stake = a.stake
    ? Data.constr(0n, [Data.constr(0n, [credentialData(a.stake)])]) // Some(Inline(cred))
    : Data.constr(1n, []); // None
  return Data.constr(0n, [credentialData(a.payment), stake]);
}
export function assetData(a: AssetId): Data.Data {
  return Data.constr(0n, [bytes(a.policy), bytes(a.name)]);
}
export function campaignDatumData(c: CampaignDatum): Data.Data {
  return Data.constr(0n, [
    bytes(c.blocId),
    bytes(c.itemHash),
    assetData(c.asset),
    int(c.membersLimit),
    int(c.minBatch),
    int(c.bidDeadline),
    int(c.refundDeadline),
    Data.list(c.providerVkeys.map(bytes)),
  ]);
}
export function pledgeDatumData(p: PledgeDatum): Data.Data {
  return Data.constr(0n, [bytes(p.blocId), addressData(p.memberRefundAddress), int(p.quantity), int(p.maxUnitPrice)]);
}
export function bidData(b: Bid): Data.Data {
  return Data.constr(0n, [
    bytes(b.blocId),
    bytes(b.itemHash),
    assetData(b.asset),
    int(b.unitPrice),
    int(b.expiry),
    bytes(b.providerVkey),
    addressData(b.providerAddress),
  ]);
}
/** Withdraw redeemer: SettleRedeemer { bid, signature, pairs: Pairs<Int, Int> } (pairs = Data map, in order). */
export function settleRedeemerData(r: { bid: Bid; signature: Hex; pairs: Array<[number | bigint, number | bigint]> }): Data.Data {
  return Data.constr(0n, [bidData(r.bid), bytes(r.signature), Data.map(r.pairs.map(([i, o]) => [int(i), int(o)]))]);
}
/** Spend redeemer Settle { input_index, withdrawal_index }: indices into tx.inputs / tx.withdrawals (sorted). */
export function settleSpendRedeemer(inputIndex: number | bigint, withdrawalIndex: number | bigint = 0): Data.Data {
  return Data.constr(0n, [int(inputIndex), int(withdrawalIndex)]);
}
/** Spend redeemer Refund { input_index, output_index }. */
export function refundSpendRedeemer(inputIndex: number | bigint, outputIndex: number | bigint): Data.Data {
  return Data.constr(1n, [int(inputIndex), int(outputIndex)]);
}
/** Inline datum the provider output (output #0 of a settlement) must carry: the campaign policy id bytes. */
export function providerOutputDatum(campaignPolicyId: Hex): Data.Data {
  return bytes(campaignPolicyId);
}
/** Inline datum each refund output must carry: the pledge's own OutputReference. */
export const refundOutputDatum = outRefData;
/** Publish redeemer for the RegCert of the bloc stake credential (any Data; the handler ignores it). */
export const publishRedeemer: Data.Data = Data.constr(0n, []);
/** Mint redeemer for the campaign policy (ignored on chain). */
export const campaignMintRedeemer: Data.Data = Data.constr(0n, []);

/**
 * CBOR options that reproduce Aiken's `cbor.serialise` byte for byte: indefinite
 * non-empty lists and constr fields, definite empty lists, DEFINITE maps.
 * Note: Evolution's own `CBOR.AIKEN_DEFAULT_OPTIONS` encodes maps as arrays of
 * pairs (`encodeMapAsPairs`), which changes the Data value (a list, not a map):
 * never use it for redeemers carrying `pairs`. Semantics only matter on chain;
 * these options are for byte-level vectors and datum hashes.
 */
export const AIKEN_CBOR: CBOR.CodecOptions = {
  mode: "custom",
  useIndefiniteArrays: true,
  useIndefiniteMaps: false,
  useDefiniteForEmpty: true,
  sortMapKeys: false,
  useMinimalEncoding: true,
  mapsAsObjects: false,
};
export const toAikenCbor = (d: Data.Data): Hex => Data.toCBORHex(d, AIKEN_CBOR);

// ---------------------------------------------------------------------------
// Data decoders (services/bloc validates pledge datums before counting them)
// ---------------------------------------------------------------------------

const hexOf = (d: Data.Data): Hex => {
  if (!(d instanceof Uint8Array)) throw new Error("expected bytes");
  return Bytes.toHex(d);
};
const intOf = (d: Data.Data): bigint => {
  if (typeof d !== "bigint") throw new Error("expected int");
  return d;
};
const constrOf = (d: Data.Data, index: bigint, arity: number): Data.Data[] => {
  if (!(d instanceof Data.Constr) || d.index !== index || d.fields.length !== arity)
    throw new Error(`expected Constr ${index} with ${arity} fields`);
  return [...d.fields];
};
function hash28(d: Data.Data): Hex {
  const h = hexOf(d);
  if (h.length !== 56) throw new Error("expected 28-byte hash");
  return h;
}
function credentialOf(d: Data.Data): PlutusCredential {
  if (!(d instanceof Data.Constr) || d.fields.length !== 1 || (d.index !== 0n && d.index !== 1n)) throw new Error("bad credential");
  return { type: d.index === 0n ? "key" : "script", hash: hash28(d.fields[0]!) };
}
export function decodeAddress(d: Data.Data): PlutusAddress {
  const [pay, st] = constrOf(d, 0n, 2);
  const payment = credentialOf(pay!);
  if (st instanceof Data.Constr && st.index === 1n && st.fields.length === 0) return { payment };
  const [ref] = constrOf(st!, 0n, 1);
  const [cred] = constrOf(ref!, 0n, 1); // pointers unsupported
  return { payment, stake: credentialOf(cred!) };
}
export function decodePledgeDatum(d: Data.Data): PledgeDatum {
  const [blocId, addr, q, p] = constrOf(d, 0n, 4);
  return { blocId: hexOf(blocId!), memberRefundAddress: decodeAddress(addr!), quantity: intOf(q!), maxUnitPrice: intOf(p!) };
}
export function decodeCampaignDatum(d: Data.Data): CampaignDatum {
  const [blocId, itemHash, asset, ml, mb, bd, rd, vks] = constrOf(d, 0n, 8);
  const [pol, name] = constrOf(asset!, 0n, 2);
  if (!Array.isArray(vks)) throw new Error("expected list of vkeys");
  return {
    blocId: hexOf(blocId!),
    itemHash: hexOf(itemHash!),
    asset: { policy: hexOf(pol!), name: hexOf(name!) },
    membersLimit: intOf(ml!),
    minBatch: intOf(mb!),
    bidDeadline: intOf(bd!),
    refundDeadline: intOf(rd!),
    providerVkeys: (vks as Data.Data[]).map(hexOf),
  };
}

// ---------------------------------------------------------------------------
// Address conversion helpers
// ---------------------------------------------------------------------------

function toEvoCredential(c: PlutusCredential): Credential.Credential {
  const h = Bytes.fromHex(c.hash);
  return c.type === "key" ? Credential.makeKeyHash(h) : Credential.makeScriptHash(h);
}
function fromEvoCredential(c: Credential.Credential): PlutusCredential {
  return { type: c._tag === "KeyHash" ? "key" : "script", hash: Bytes.toHex(c.hash) };
}
/** bech32 (base or enterprise) -> Plutus address. */
export function plutusAddressFromBech32(bech32: string): PlutusAddress {
  const a = Address.fromBech32(bech32);
  return {
    payment: fromEvoCredential(a.paymentCredential),
    ...(a.stakingCredential ? { stake: fromEvoCredential(a.stakingCredential) } : {}),
  };
}
export function plutusAddressToBech32(a: PlutusAddress, networkId = 0): string {
  return Address.toBech32(
    new Address.Address({
      networkId,
      paymentCredential: toEvoCredential(a.payment),
      ...(a.stake ? { stakingCredential: toEvoCredential(a.stake) } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// Bid message (fixed layout, MUST match lib/bloc/message.ak, see README)
// ---------------------------------------------------------------------------

export const BID_MAGIC = "BLOCBID1";

function fromHex(h: Hex, what: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error(`${what}: invalid hex`);
  return Bytes.fromHex(h.toLowerCase());
}
function fixed(h: Hex, len: number, what: string): Uint8Array {
  const b = fromHex(h, what);
  if (b.length !== len) throw new Error(`${what}: expected ${len} bytes, got ${b.length}`);
  return b;
}
function lp(h: Hex, what: string): Uint8Array {
  const b = fromHex(h, what);
  if (b.length > 255) throw new Error(`${what}: longer than 255 bytes`);
  return Uint8Array.of(b.length, ...b);
}
function u64be(n: bigint, what: string): Uint8Array {
  if (n < 0n || n >= 1n << 64n) throw new Error(`${what}: out of u64 range`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
}
function credBytes(c: PlutusCredential, tagKey: number, tagScript: number): Uint8Array {
  return Uint8Array.of(c.type === "key" ? tagKey : tagScript, ...fixed(c.hash, 28, "credential hash"));
}
function addressBytes(a: PlutusAddress): Uint8Array {
  const pay = credBytes(a.payment, 0x00, 0x01);
  const stake = a.stake ? credBytes(a.stake, 0x01, 0x02) : Uint8Array.of(0x00);
  return Uint8Array.of(...pay, ...stake);
}

/**
 * "BLOCBID1" ‖ campaign_policy(28) ‖ lp(bloc_id) ‖ lp(item_hash) ‖ lp(asset.policy) ‖ lp(asset.name)
 * ‖ u64be(unit_price) ‖ u64be(expiry) ‖ provider_vkey(32) ‖ address(provider_address)
 */
export function bidMessage(campaignPolicyId: Hex, bid: Bid): Uint8Array {
  const parts = [
    new TextEncoder().encode(BID_MAGIC),
    fixed(campaignPolicyId, 28, "campaign policy"),
    lp(bid.blocId, "bloc_id"),
    lp(bid.itemHash, "item_hash"),
    lp(bid.asset.policy, "asset.policy"),
    lp(bid.asset.name, "asset.name"),
    u64be(bid.unitPrice, "unit_price"),
    u64be(bid.expiry, "expiry"),
    fixed(bid.providerVkey, 32, "provider_vkey"),
    addressBytes(bid.providerAddress),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** ed25519 public key (hex) from a 32-byte secret seed. */
export function vkeyFromSecret(secretKey: Uint8Array): Hex {
  return Bytes.toHex(ed25519.getPublicKey(secretKey));
}

/** Sign a bid; the bid's providerVkey must belong to secretKey. Returns the 64-byte signature hex. */
export function signBid(secretKey: Uint8Array, campaignPolicyId: Hex, bid: Bid): Hex {
  if (vkeyFromSecret(secretKey) !== bid.providerVkey.toLowerCase()) throw new Error("secret key does not match bid.providerVkey");
  return Bytes.toHex(ed25519.sign(bidMessage(campaignPolicyId, bid), secretKey));
}

/** Off-chain mirror of the on-chain check (length checks first, then verify). */
export function verifyBid(campaignPolicyId: Hex, bid: Bid, signature: Hex): boolean {
  try {
    const sig = fixed(signature, 64, "signature");
    const vk = fixed(bid.providerVkey, 32, "provider_vkey");
    return ed25519.verify(sig, bidMessage(campaignPolicyId, bid), vk);
  } catch {
    return false;
  }
}

/** Convenience: the amount each settled pledge pays and gets back. */
export function settlementAmounts(pledges: Array<{ quantity: bigint; lockedAsset: bigint }>, unitPrice: bigint) {
  const perPledge = pledges.map((p) => ({ paid: unitPrice * p.quantity, refundAsset: p.lockedAsset - unitPrice * p.quantity }));
  return { providerTotal: perPledge.reduce((s, p) => s + p.paid, 0n), perPledge };
}

export { Data };
