/**
 * Pure settlement planning (no I/O, no chain): validate pledge UTxOs against the campaign, verify and rank signed
 * bids, and cut the eligible pledges into settlement batches of at most N_max with exact per-pledge amounts.
 *
 * Mirrors the on-chain rules in contracts/bloc/README.md so that the builder never includes a pledge that would make
 * the whole settlement fail: wrong bloc id, unparseable datum, unfunded (holds < max_unit_price x quantity),
 * priced below the bid, or holding a campaign-policy token are skipped (and stay refundable after the deadline).
 */
import {
  decodePledgeDatum, settlementAmounts, verifyBid,
  type AssetId, type Bid, type Data, type Hex, type OutRef, type PledgeDatum, type PlutusAddress,
} from '@overpaid/bloc-contract';
import { MIN_REFUND_LOVELACE } from './units.js';

export interface CampaignInfo {
  /** Campaign NFT policy id = the bloc script parameter. */
  policyId: Hex;
  blocId: Hex;
  itemHash: Hex;
  asset: AssetId;
  minBatch: bigint;
  membersLimit: bigint;
  bidDeadline: bigint; // POSIX ms
  refundDeadline: bigint; // POSIX ms
  providerVkeys: Hex[];
}

/** What the chain (or a fixture) tells us about one UTxO at the bloc address. */
export interface ChainPledge {
  ref: OutRef;
  lovelace: bigint;
  /** Quantity of the campaign asset when it is a token (ignored for ADA, where it is the lovelace). */
  assetQty?: bigint;
  /** Inline datum, if any (undefined/null = no inline datum). */
  datum?: Data.Data | null;
  /** true if the UTxO holds any token of the campaign policy (the campaign UTxO itself): never spendable. */
  holdsCampaignToken?: boolean;
}

export interface ValidPledge {
  ref: OutRef;
  lovelace: bigint;
  /** Locked quantity of the campaign asset (lovelace when the asset is ADA). */
  locked: bigint;
  datum: PledgeDatum;
}

export type PledgeCheck = { ok: true; pledge: ValidPledge } | { ok: false; reason: string };

export const isAda = (a: AssetId) => a.policy === '' && a.name === '';
export const refKey = (r: OutRef) => `${r.txHash.toLowerCase()}#${r.index}`;

/** Validate the datum and the locked value of a pledge UTxO (the facilitator does not; docs/BRIEF.md x402 rules). */
export function validatePledge(c: CampaignInfo, p: ChainPledge): PledgeCheck {
  if (p.holdsCampaignToken) return { ok: false, reason: 'holds a campaign token (campaign UTxO)' };
  if (p.datum === undefined || p.datum === null) return { ok: false, reason: 'no inline datum' };
  let d: PledgeDatum;
  try {
    d = decodePledgeDatum(p.datum);
  } catch (e) {
    return { ok: false, reason: `datum is not a PledgeDatum: ${(e as Error).message}` };
  }
  if (d.blocId.toLowerCase() !== c.blocId.toLowerCase()) return { ok: false, reason: 'datum bloc_id is for another bloc' };
  if (d.quantity <= 0n) return { ok: false, reason: 'quantity must be > 0' };
  if (d.maxUnitPrice <= 0n) return { ok: false, reason: 'max_unit_price must be > 0' };
  const locked = isAda(c.asset) ? p.lovelace : (p.assetQty ?? 0n);
  if (locked < d.maxUnitPrice * d.quantity) return { ok: false, reason: `unfunded: locks ${locked}, datum needs ${d.maxUnitPrice * d.quantity}` };
  return { ok: true, pledge: { ref: p.ref, lovelace: p.lovelace, locked, datum: d } };
}

// ---------------------------------------------------------------------------------------------------- bids

export interface IncomingBid {
  bid: Bid;
  signature: Hex;
}
export type BidCheck = { valid: true } | { valid: false; reason: string };

/** Off-chain mirror of the withdraw checks on the bid: campaign match, allowlist, deadlines, ed25519 signature. */
export function checkBid(c: CampaignInfo, { bid, signature }: IncomingBid, nowMs: bigint): BidCheck {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!eq(bid.blocId, c.blocId)) return { valid: false, reason: 'bid is for another bloc' };
  if (!eq(bid.itemHash, c.itemHash)) return { valid: false, reason: 'item hash mismatch' };
  if (!eq(bid.asset.policy, c.asset.policy) || !eq(bid.asset.name, c.asset.name)) return { valid: false, reason: 'asset mismatch' };
  if (bid.unitPrice <= 0n) return { valid: false, reason: 'unit price must be > 0' };
  if (!c.providerVkeys.some((k) => eq(k, bid.providerVkey))) return { valid: false, reason: 'provider key is not in the campaign allowlist' };
  if (bid.expiry <= nowMs) return { valid: false, reason: 'bid expired' };
  if (c.bidDeadline <= nowMs) return { valid: false, reason: 'bid deadline passed' };
  if (!verifyBid(c.policyId, bid, signature)) return { valid: false, reason: 'bad signature' };
  return { valid: true };
}

export interface RankedBid extends IncomingBid {
  id: string;
  valid: boolean;
  at: number;
}

/**
 * Best valid bid: lowest unit price among valid bids that are still usable `marginMs` from now (settlement needs a
 * validity upper bound before both the bid expiry and the bid deadline); ties go to the earliest bid.
 */
export function chooseBestBid<T extends RankedBid>(bids: T[], c: CampaignInfo, nowMs: bigint, marginMs = 120_000n): T | null {
  const usable = bids.filter((b) => b.valid && b.bid.expiry > nowMs + marginMs && c.bidDeadline > nowMs + marginMs);
  usable.sort((a, b) => (a.bid.unitPrice === b.bid.unitPrice ? a.at - b.at : a.bid.unitPrice < b.bid.unitPrice ? -1 : 1));
  return usable[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------- batches

export interface RefundLine {
  ref: OutRef;
  address: PlutusAddress;
  /** Lovelace in the refund output. */
  lovelace: bigint;
  /** Campaign-asset quantity in the refund output (0 / unused for ADA). */
  asset: bigint;
  paid: bigint;
}
export interface SettlementBatch {
  /** Pledges in ledger input order (tx id bytes, then index): refund output #k+1 belongs to pledges[k]. */
  pledges: ValidPledge[];
  providerTotal: bigint;
  refunds: RefundLine[];
}
export interface SettlementPlan {
  unitPrice: bigint;
  batches: SettlementBatch[];
  skipped: Array<{ ref: OutRef; reason: string }>;
}

/** Ledger order of inputs: transaction id bytes (lowercase hex compares the same), then output index. */
export function compareOutRef(a: OutRef, b: OutRef): number {
  const ta = a.txHash.toLowerCase(), tb = b.txHash.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return Number(BigInt(a.index) - BigInt(b.index));
}

/** Split n items into ceil(n / nMax) chunks whose sizes differ by at most one (maximises the smallest batch). */
export function chunkEven<T>(items: T[], nMax: number): T[][] {
  if (nMax < 1) throw new Error('nMax must be >= 1');
  if (!items.length) return [];
  const k = Math.ceil(items.length / nMax);
  const base = Math.floor(items.length / k), extra = items.length % k;
  const out: T[][] = [];
  let i = 0;
  for (let j = 0; j < k; j++) {
    const size = base + (j < extra ? 1 : 0);
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out;
}

export function planSettlement(
  c: CampaignInfo,
  pledges: ValidPledge[],
  unitPrice: bigint,
  opts: { nMax: number; minRefundLovelace?: bigint },
): SettlementPlan {
  const minRefund = opts.minRefundLovelace ?? MIN_REFUND_LOVELACE;
  const ada = isAda(c.asset);
  const skipped: SettlementPlan['skipped'] = [];
  const seen = new Set<string>();
  const eligible: ValidPledge[] = [];
  for (const p of pledges) {
    const k = refKey(p.ref);
    if (seen.has(k)) continue;
    seen.add(k);
    if (p.datum.maxUnitPrice < unitPrice) { skipped.push({ ref: p.ref, reason: 'max_unit_price below the winning bid' }); continue; }
    if (p.locked < p.datum.maxUnitPrice * p.datum.quantity) { skipped.push({ ref: p.ref, reason: 'unfunded' }); continue; }
    const paid = unitPrice * p.datum.quantity;
    const refundLovelace = ada ? p.lovelace - paid : p.lovelace;
    if (refundLovelace < minRefund) { skipped.push({ ref: p.ref, reason: `refund ${refundLovelace} lovelace would be below min-UTxO` }); continue; }
    eligible.push(p);
  }
  eligible.sort((a, b) => compareOutRef(a.ref, b.ref));
  if (BigInt(eligible.length) < c.minBatch) {
    for (const p of eligible) skipped.push({ ref: p.ref, reason: `fewer than min_batch (${c.minBatch}) eligible pledges` });
    return { unitPrice, batches: [], skipped };
  }
  const batches = chunkEven(eligible, opts.nMax).map((chunk): SettlementBatch => {
    const amounts = settlementAmounts(chunk.map((p) => ({ quantity: p.datum.quantity, lockedAsset: p.locked })), unitPrice);
    const refunds = chunk.map((p, i): RefundLine => {
      const a = amounts.perPledge[i]!;
      return {
        ref: p.ref,
        address: p.datum.memberRefundAddress,
        lovelace: ada ? a.refundAsset : p.lovelace,
        asset: ada ? 0n : a.refundAsset,
        paid: a.paid,
      };
    });
    return { pledges: chunk, providerTotal: amounts.providerTotal, refunds };
  });
  return { unitPrice, batches, skipped };
}

/** Refund path (after refund_deadline): every pledge with a parseable datum, regardless of bloc id or price. */
export function planRefunds(pledges: ValidPledge[], nowMs: bigint, c: CampaignInfo, nMax: number): ValidPledge[][] {
  if (nowMs <= c.refundDeadline) throw new Error(`refund deadline not reached (${new Date(Number(c.refundDeadline)).toISOString()})`);
  return chunkEven([...pledges].sort((a, b) => compareOutRef(a.ref, b.ref)), nMax);
}

/** The withdraw redeemer's pairs for a batch, given each pledge's final sorted input index. */
export function settlePairs(inputIndexByRef: Map<string, number>, batch: SettlementBatch): Array<[number, number]> {
  const pairs = batch.pledges.map((p, k): [number, number] => {
    const i = inputIndexByRef.get(refKey(p.ref));
    if (i === undefined) throw new Error(`pledge ${refKey(p.ref)} is not an input`);
    return [i, k + 1];
  });
  for (let k = 1; k < pairs.length; k++) {
    if (!(pairs[k]![0] > pairs[k - 1]![0])) throw new Error('pledge inputs are not in ledger order');
  }
  return pairs;
}
