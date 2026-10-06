/**
 * Non-custodial (CIP-30) transaction helpers. The server builds unsigned transactions from the user's own UTxOs
 * (Evolution read-only builder), the browser wallet signs with `signTx(cbor, partialSign = true)`, and the server
 * merges the returned witness set and RE-VALIDATES the exact bytes before submitting them to Blockfrost.
 *
 * Everything here is pure (no network) so the validation is unit tested.
 */
import {
  Address, AddressEras, Assets, CBOR, InlineDatum, KeyHash, Schema, Script, Transaction, TransactionBody, TransactionHash,
  TransactionInput, TransactionOutput, UTxO, VKey,
} from '@evolution-sdk/evolution';
import { decodePledgeDatum, plutusAddressFromBech32, plutusAddressToBech32, type PledgeDatum } from '@overpaid/bloc-contract';
import type { CampaignRecord } from './store.js';
import { MAX_PLEDGE_LOVELACE, PLEDGE_LOCK_LOVELACE } from './units.js';

/** CIP-30 `getUtxos()` item (CBOR `[transaction_input, transaction_output]`) -> Evolution UTxO. Mirrors Evolution's internal cip30 wallet parser. */
export function utxoFromCip30Hex(hex: string): UTxO.UTxO {
  const decoded = CBOR.fromCBORHex(hex);
  if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error('unexpected CIP-30 UTxO CBOR shape');
  const input = TransactionInput.fromCBORBytes(CBOR.toCBORBytes(decoded[0]));
  const output = TransactionOutput.fromCBORBytes(CBOR.toCBORBytes(decoded[1]));
  const address = Schema.decodeSync(Address.FromBytes)(Schema.encodeSync(AddressEras.FromBytes)(output.address));
  const amount = output.amount;
  const assets = amount._tag === 'WithAssets' ? Assets.withMultiAsset(amount.coin, amount.assets) : Assets.fromLovelace(amount.coin);
  const datumOption = output._tag === 'BabbageTransactionOutput' ? output.datumOption : output.datumHash;
  const scriptRef = output._tag === 'BabbageTransactionOutput' && output.scriptRef ? Script.fromCBOR(output.scriptRef.bytes) : undefined;
  return new UTxO.UTxO({ transactionId: input.transactionId, index: input.index, address, assets, datumOption, scriptRef });
}

/** Parse the user's UTxOs; keep only plain (no datum, no script ref) ones at a key address, so nothing script-locked gets dragged in. */
export function parseUserUtxos(hexes: unknown): UTxO.UTxO[] {
  if (!Array.isArray(hexes) || !hexes.length || hexes.length > 300 || hexes.some((h) => typeof h !== 'string' || !/^[0-9a-f]+$/i.test(h))) {
    throw new Error('utxos must be a non-empty array of CBOR hex strings (CIP-30 getUtxos)');
  }
  return hexes.map(utxoFromCip30Hex).filter((u) => u.scriptRef === undefined && u.datumOption === undefined && u.address.paymentCredential._tag === 'KeyHash');
}

/** Payment key hash of a bech32 key address, or throws. */
export function paymentKeyHashOf(bech32: string): string {
  let a: Address.Address;
  try {
    a = Address.fromBech32(bech32);
  } catch {
    throw new Error('address is not a valid bech32 Cardano address');
  }
  if (a.networkId !== 0) throw new Error('address must be a preprod (testnet) address');
  if (a.paymentCredential._tag !== 'KeyHash') throw new Error('address must have a key payment credential');
  return KeyHash.toHex(a.paymentCredential);
}

export const txHashOfCbor = (txCbor: string): string =>
  TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Buffer.from(txCbor, 'hex'))));

/** Merge a CIP-30 witness set into the transaction, preserving the body bytes (tx id and script data hash stay stable). */
export function mergeWitnesses(txCbor: string, witnessSetHex: string): string {
  if (!/^[0-9a-f]+$/i.test(txCbor) || !/^[0-9a-f]+$/i.test(witnessSetHex)) throw new Error('txCbor and witnessSet must be hex');
  return Transaction.addVKeyWitnessesHex(txCbor, witnessSetHex);
}

/** Key hashes whose vkey witness signs this transaction's body (signature actually verified). */
export function signingKeyHashes(signedCbor: string): Set<string> {
  const bytes = Buffer.from(signedCbor, 'hex');
  const bodyHash = TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(bytes)).hash;
  const tx = Transaction.fromCBORBytes(bytes);
  const out = new Set<string>();
  for (const w of tx.witnessSet.vkeyWitnesses ?? []) {
    if (VKey.verify(w.vkey, bodyHash, w.signature.bytes)) out.add(KeyHash.toHex(KeyHash.fromVKey(w.vkey)));
  }
  return out;
}

export interface PledgeTxCheck {
  txHash: string;
  outputIndex: number;
  lockedLovelace: bigint;
  refundAddress: string;
  datum: PledgeDatum;
}

const sameAddr = (a: { payment: { type: string; hash: string }; stake?: unknown }, b: typeof a) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Validate a signed pledge transaction before it is submitted: exactly one output at the bloc script address,
 * lovelace only and at least the pledge lock, inline PledgeDatum for this bloc with quantity 1 and the standard cap,
 * a key refund address whose payment key signed the transaction, and no minting at all (so no campaign-policy tokens).
 */
export function validatePledgeTx(signedCbor: string, c: Pick<CampaignRecord, 'scriptAddress' | 'blocIdHex' | 'policyId'>): PledgeTxCheck {
  let tx: Transaction.Transaction;
  try {
    tx = Transaction.fromCBORHex(signedCbor);
  } catch (e) {
    throw new Error(`not a Cardano transaction: ${(e as Error).message}`);
  }
  if (tx.body.mint) throw new Error('a pledge transaction must not mint or burn tokens');
  const atScript = tx.body.outputs.map((o, i) => ({ o, i })).filter(({ o }) => Address.toBech32(o.address) === c.scriptAddress);
  if (atScript.length !== 1) throw new Error(`expected exactly one output at the bloc address, found ${atScript.length}`);
  const { o, i } = atScript[0]!;
  const lovelace = Assets.lovelaceOf(o.assets);
  if (!Assets.hasOnlyLovelace(o.assets)) throw new Error('the pledge output must hold lovelace only');
  if (lovelace < PLEDGE_LOCK_LOVELACE) throw new Error(`the pledge output locks ${lovelace} lovelace, needs at least ${PLEDGE_LOCK_LOVELACE}`);
  for (const out of tx.body.outputs) {
    if (Assets.getUnits(out.assets).some((u) => u.startsWith(c.policyId))) throw new Error('the transaction must not move campaign-policy tokens');
  }
  if (!(o.datumOption instanceof InlineDatum.InlineDatum)) throw new Error('the pledge output needs an inline datum');
  if (o.scriptRef) throw new Error('the pledge output must not carry a reference script');
  const datumOption = o.datumOption;
  let datum: PledgeDatum;
  try {
    datum = decodePledgeDatum(datumOption.data);
  } catch (e) {
    throw new Error(`the inline datum is not a PledgeDatum: ${(e as Error).message}`);
  }
  if (datum.blocId.toLowerCase() !== c.blocIdHex.toLowerCase()) throw new Error('datum bloc_id is for another bloc');
  if (datum.quantity !== 1n) throw new Error('datum quantity must be 1');
  if (datum.maxUnitPrice !== MAX_PLEDGE_LOVELACE) throw new Error(`datum max_unit_price must be ${MAX_PLEDGE_LOVELACE}`);
  if (datum.memberRefundAddress.payment.type !== 'key') throw new Error('member_refund_address must be a key address');
  const signers = signingKeyHashes(signedCbor);
  if (!signers.has(datum.memberRefundAddress.payment.hash.toLowerCase())) {
    throw new Error('member_refund_address payment key did not sign this transaction (refund address must be your own wallet)');
  }
  return { txHash: txHashOfCbor(signedCbor), outputIndex: i, lockedLovelace: lovelace, refundAddress: plutusAddressToBech32(datum.memberRefundAddress, 0), datum };
}

/** true if the bech32 address's Plutus encoding equals the datum's refund address. */
export const refundAddressMatches = (bech32: string, datum: PledgeDatum) => sameAddr(plutusAddressFromBech32(bech32), datum.memberRefundAddress);

/** Raw submit through Blockfrost (keeps the exact signed bytes). Returns the tx hash. */
export async function submitCbor(bf: { baseUrl: string; projectId: string }, signedCbor: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await fetchImpl(`${bf.baseUrl}/tx/submit`, {
    method: 'POST', headers: { project_id: bf.projectId, 'content-type': 'application/cbor' }, body: Buffer.from(signedCbor, 'hex'),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Blockfrost submit ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as string;
}
