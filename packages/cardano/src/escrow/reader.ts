/**
 * Escrow state reader. An escrow is identified by its reference_signature (unique per escrow; the validator enforces
 * uniqueness across script inputs/outputs). We locate it by following the spend chain from the lock tx through
 * Blockfrost `/txs/{hash}/utxos` (outputs carry `inline_datum` and `consumed_by_tx`), so no full escrow scan is needed.
 */
import { TransactionHash, TransactionInput, type UTxO } from '@evolution-sdk/evolution';
import { decodeBlockchainIdentifier } from '@x402/cardano';
import { ESCROW_ADDRESS } from '../constants.js';
import type { Blockfrost } from '../provider.js';
import { decodeEscrowDatum, stateName, type EscrowDatum } from './datum.js';
import { toEscrowUtxo, type EscrowUtxo } from './plan.js';

export interface TxOutputRow {
  output_index: number;
  address: string;
  amount: Array<{ unit: string; quantity: string }>;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
  consumed_by_tx?: string | null;
  collateral?: boolean;
}

export async function txOutputs(bf: Blockfrost, txHash: string): Promise<TxOutputRow[] | null> {
  const r = await bf.get<{ outputs: TxOutputRow[] }>(`/txs/${txHash}/utxos`);
  return r ? r.outputs : null;
}

export interface EscrowCandidate {
  txHash: string;
  outputIndex: number;
  datum: EscrowDatum | null;
  lovelace: bigint;
  tokens: Record<string, bigint>;
  hasReferenceScript: boolean;
  consumedBy: string | null;
}

export function escrowCandidates(txHash: string, rows: TxOutputRow[]): EscrowCandidate[] {
  return rows
    .filter((r) => r.address === ESCROW_ADDRESS && !r.collateral)
    .map((r) => {
      const tokens: Record<string, bigint> = {};
      let lovelace = 0n;
      for (const a of r.amount) {
        if (a.unit === 'lovelace') lovelace = BigInt(a.quantity);
        else tokens[a.unit] = BigInt(a.quantity);
      }
      return {
        txHash, outputIndex: r.output_index, datum: r.inline_datum ? decodeEscrowDatum(r.inline_datum) : null,
        lovelace, tokens, hasReferenceScript: Boolean(r.reference_script_hash), consumedBy: r.consumed_by_tx ?? null,
      };
    });
}

export interface EscrowHistoryEntry {
  txHash: string;
  outputIndex: number;
  state: string;
  resultHash: string;
}

export type EscrowStatus =
  | { status: 'not_found' }
  | { status: 'open'; current: EscrowCandidate; datum: EscrowDatum; state: string; history: EscrowHistoryEntry[] }
  | { status: 'closed'; closedBy: string; last: EscrowCandidate; history: EscrowHistoryEntry[] };

/**
 * Follow an escrow from a starting tx (normally the lock tx) to its current UTxO.
 * @param referenceSignature which escrow in the tx to follow (required if the tx holds several)
 */
export async function followEscrow(bf: Blockfrost, startTxHash: string, referenceSignature?: string, maxHops = 16): Promise<EscrowStatus> {
  let txHash = startTxHash;
  let refSig = referenceSignature?.toLowerCase();
  let prev: EscrowCandidate | null = null;
  const history: EscrowHistoryEntry[] = [];
  for (let hop = 0; hop < maxHops; hop++) {
    const rows = await txOutputs(bf, txHash);
    const cands = rows ? escrowCandidates(txHash, rows).filter((c) => c.datum && (!refSig || c.datum.referenceSignature === refSig)) : [];
    if (cands.length === 0) {
      // Not found at the start, or the previous escrow output was spent by a terminal tx (Withdraw / WithdrawRefund).
      return prev ? { status: 'closed', closedBy: txHash, last: prev, history } : { status: 'not_found' };
    }
    if (cands.length > 1 && !refSig) throw new Error(`tx ${txHash} holds ${cands.length} escrows; pass a referenceSignature`);
    const c = cands[0]!;
    const d = c.datum!;
    refSig = d.referenceSignature;
    history.push({ txHash, outputIndex: c.outputIndex, state: stateName(d.state), resultHash: d.resultHash });
    if (!c.consumedBy) return { status: 'open', current: c, datum: d, state: stateName(d.state), history };
    prev = c;
    txHash = c.consumedBy;
  }
  throw new Error(`escrow chain from ${startTxHash} is longer than ${maxHops} hops`);
}

/** Follow an escrow given its x402 blockchainIdentifier and the lock tx hash. */
export async function escrowByIdentifier(bf: Blockfrost, blockchainIdentifier: string, lockTxHash: string): Promise<EscrowStatus> {
  const parts = decodeBlockchainIdentifier(blockchainIdentifier);
  if (!parts) throw new Error('invalid blockchainIdentifier');
  return followEscrow(bf, lockTxHash, parts.referenceSignature);
}

/** Load the spendable Evolution UTxO for an open escrow (needed to build the next tx). */
export async function loadEscrowUtxo(client: { getUtxosByOutRef: (refs: ReadonlyArray<TransactionInput.TransactionInput>) => Promise<ReadonlyArray<UTxO.UTxO>> }, c: { txHash: string; outputIndex: number }): Promise<EscrowUtxo> {
  const [u] = await client.getUtxosByOutRef([
    new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(c.txHash), index: BigInt(c.outputIndex) }),
  ]);
  if (!u) throw new Error(`escrow UTxO ${c.txHash}#${c.outputIndex} is not in the UTxO set (spent or not yet indexed)`);
  return toEscrowUtxo(u);
}
