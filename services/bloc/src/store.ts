/**
 * Bloc state: one active campaign, its pledges, bids and settlements. Kept in memory and snapshotted to a JSON file
 * (BLOC_STATE_FILE, default data/bloc/state.json) so a restart keeps the campaign and its pledge records.
 * The chain stays the source of truth for funds: settlement and refunds re-read the bloc address.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CampaignInfo } from './planner.js';
import type { BidSubmission } from './wire.js';

export type CampaignState = 'open' | 'settling' | 'settled' | 'refunding' | 'refunded';

export interface CampaignRecord {
  id: string; // human id, also the bloc_id text (hex-encoded on chain)
  item: string;
  itemHash: string;
  asset: { policy: string; name: string; label: string };
  unitLabel: string;
  membersLimit: number;
  minBatch: number;
  bidDeadline: number; // POSIX ms
  refundDeadline: number; // POSIX ms
  providerVkeys: string[];
  policyId: string;
  blocHash: string;
  blocIdHex: string;
  seed: { txHash: string; index: number };
  campaignTx: string | null;
  scriptAddress: string;
  state: CampaignState;
  marketPrice: string; // lovelace
  createdAt: number;
}

export interface PledgeRecord {
  id: string;
  label: string;
  simulated: boolean;
  wallet: string | null;
  refundAddress: string;
  txHash: string;
  outputIndex: number;
  quantity: number;
  maxUnitPrice: string; // lovelace
  locked: string; // lovelace
  /** How the pledge reached the chain. */
  via: 'cip30' | 'custodial-demo' | 'x402-script' | 'direct-submit' | 'simulated-batch';
  state: 'submitted' | 'settled' | 'refunded' | 'invalid';
  reason?: string;
  settlementTxHash?: string;
  refundTxHash?: string;
  at: number;
}

export interface BidRecord extends BidSubmission {
  id: string;
  valid: boolean;
  reason: string | null;
  at: number;
}

export interface SettlementRecord {
  id: string;
  txHash: string;
  pledgeCount: number;
  unitPrice: string;
  bidId: string;
  kind: 'settle' | 'refund';
  at: number;
}

export interface BlocSnapshot {
  campaign: CampaignRecord | null;
  pledges: PledgeRecord[];
  bids: BidRecord[];
  settlements: SettlementRecord[];
  nMax: number | null;
}

export const emptySnapshot = (): BlocSnapshot => ({ campaign: null, pledges: [], bids: [], settlements: [], nMax: null });

export class BlocStore {
  data: BlocSnapshot;
  constructor(private readonly file: string | null = null) {
    this.data = emptySnapshot();
    if (file && existsSync(file)) {
      try {
        this.data = { ...emptySnapshot(), ...(JSON.parse(readFileSync(file, 'utf8')) as BlocSnapshot) };
      } catch (e) {
        console.warn(`[bloc] ignoring unreadable state file ${file}: ${(e as Error).message}`);
      }
    }
  }

  save(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    renameSync(tmp, this.file);
  }

  /** Replace the campaign (a new campaign starts with empty pledges, bids and settlements). */
  setCampaign(c: CampaignRecord): void {
    this.data = { ...emptySnapshot(), nMax: this.data.nMax, campaign: c };
    this.save();
  }
  patchCampaign(p: Partial<CampaignRecord>): void {
    if (!this.data.campaign) throw new Error('no campaign');
    this.data.campaign = { ...this.data.campaign, ...p };
    this.save();
  }
  addPledges(ps: PledgeRecord[]): void {
    this.data.pledges.push(...ps);
    this.save();
  }
  markPledges(keys: Set<string>, state: PledgeRecord['state'], reason?: string, patch: Partial<Pick<PledgeRecord, 'settlementTxHash' | 'refundTxHash'>> = {}): void {
    for (const p of this.data.pledges) {
      if (keys.has(`${p.txHash.toLowerCase()}#${p.outputIndex}`)) {
        p.state = state;
        if (reason) p.reason = reason;
        Object.assign(p, patch);
      }
    }
    this.save();
  }
  addBid(b: BidRecord): void {
    this.data.bids.push(b);
    if (this.data.bids.length > 500) this.data.bids = this.data.bids.slice(-500);
    this.save();
  }
  addSettlement(s: SettlementRecord): void {
    this.data.settlements.push(s);
    this.save();
  }
}

/** Planner view of the stored campaign. */
export function campaignInfo(c: CampaignRecord): CampaignInfo {
  return {
    policyId: c.policyId,
    blocId: c.blocIdHex,
    itemHash: c.itemHash,
    asset: { policy: c.asset.policy, name: c.asset.name },
    minBatch: BigInt(c.minBatch),
    membersLimit: BigInt(c.membersLimit),
    bidDeadline: BigInt(c.bidDeadline),
    refundDeadline: BigInt(c.refundDeadline),
    providerVkeys: c.providerVkeys,
  };
}
