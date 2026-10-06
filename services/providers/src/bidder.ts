/**
 * Bid construction and the bidding loop: read GET bloc /state (+ /campaign/terms), price with the brand strategy,
 * sign the fixed-layout bid with the provider's ed25519 key, POST bloc /bids.
 */
import { plutusAddressFromBech32, signBid, type Bid } from '@overpaid/bloc-contract';
import { bidToWire, type BidSubmission } from '@overpaid/bloc/wire';
import { quote, type Brand } from './brands.js';
import type { ProviderKeys } from './keys.js';

export interface CampaignTerms {
  id: string;
  state: string;
  policyId: string;
  blocId: string;
  itemHash: string;
  asset: { policy: string; name: string };
  bidDeadline: number;
  providerVkeys: string[];
  maxUnitPrice: string;
  members: number;
}

export function makeBid(brand: Brand, keys: ProviderKeys, t: CampaignTerms, unitPrice: bigint, expiry: bigint): BidSubmission {
  const bid: Bid = {
    blocId: t.blocId, itemHash: t.itemHash, asset: t.asset, unitPrice, expiry, providerVkey: keys.vkey,
    providerAddress: plutusAddressFromBech32(keys.address),
  };
  return { provider: brand.name, strategy: brand.strategy, simulated: true, bid: bidToWire(bid), signature: signBid(keys.secretKey, t.policyId, bid) };
}

interface StateBid { provider: string; unitPrice: number; valid: boolean }

export interface AgentEntry {
  brand: Brand;
  keys: ProviderKeys;
  last: { unitPrice: bigint; expiry: bigint; campaign: string } | null;
  lastResult: string | null;
}

export class Bidder {
  constructor(
    readonly agents: AgentEntry[],
    private readonly blocUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async get<T>(path: string): Promise<T | null> {
    const r = await this.fetchImpl(`${this.blocUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return (await r.json()) as T;
  }

  /** One round: every provider re-quotes and posts if its price changed or its bid nears expiry. Returns bids posted. */
  async tick(): Promise<number> {
    const state = await this.get<{ campaign: { state: string } | null; bids: StateBid[] }>('/state');
    if (!state?.campaign || state.campaign.state !== 'open') return 0;
    const terms = await this.get<CampaignTerms>('/campaign/terms');
    if (!terms || terms.state !== 'open' || terms.bidDeadline <= this.now() + 60_000) return 0;
    let posted = 0;
    for (const a of this.agents) {
      if (!terms.providerVkeys.includes(a.keys.vkey)) {
        a.lastResult = 'not in this campaign allowlist';
        continue;
      }
      const rivals = state.bids.filter((b) => b.valid && b.provider !== a.brand.name).map((b) => BigInt(b.unitPrice));
      const bestRival = rivals.length ? rivals.reduce((m, x) => (x < m ? x : m)) : null;
      const previous = a.last?.campaign === terms.id ? a.last.unitPrice : null;
      const price = quote(a.brand, { members: terms.members, bestRival, previous, maxUnitPrice: BigInt(terms.maxUnitPrice) });
      const expiry = BigInt(Math.min(terms.bidDeadline, this.now() + 2 * 3_600_000));
      const fresh = a.last && a.last.campaign === terms.id && a.last.unitPrice === price && a.last.expiry > BigInt(this.now() + 10 * 60_000);
      if (fresh) continue;
      const sub = makeBid(a.brand, a.keys, terms, price, expiry);
      const r = await this.fetchImpl(`${this.blocUrl}/bids`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub), signal: AbortSignal.timeout(5_000) });
      const body = (await r.json().catch(() => ({}))) as { valid?: boolean; reason?: string | null };
      a.lastResult = body.valid ? `bid ${price} accepted` : `bid rejected: ${body.reason ?? r.status}`;
      a.last = { unitPrice: price, expiry, campaign: terms.id };
      posted++;
    }
    return posted;
  }
}
