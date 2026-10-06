import { describe, expect, it } from 'vitest';
import { blocAddress, blocScript, campaignPolicy, verifyBid } from '@overpaid/bloc-contract';
import { bidFromWire, checkBid, type CampaignInfo } from '@overpaid/bloc';
import { BRANDS, listPrice, quote } from '../src/brands.js';
import { Bidder, makeBid, type CampaignTerms } from '../src/bidder.js';
import { providerKeys } from '../src/keys.js';

const MNEMONIC = `${'abandon '.repeat(23)}art`; // public BIP-39 test vector, never funded
const keys = BRANDS.map((b) => providerKeys(b.key, MNEMONIC));
const policy = campaignPolicy({ txHash: '5e'.repeat(32), index: 1 });
const NOW = Date.now();

const terms: CampaignTerms = {
  id: 'esim-eu-test', state: 'open', policyId: policy.hash, blocId: Buffer.from('esim-eu-test').toString('hex'), itemHash: 'ab'.repeat(32),
  asset: { policy: '', name: '' }, bidDeadline: NOW + 3_600_000, providerVkeys: keys.map((k) => k.vkey), maxUnitPrice: '3000000', members: 40,
};
const info: CampaignInfo = {
  policyId: terms.policyId, blocId: terms.blocId, itemHash: terms.itemHash, asset: terms.asset, minBatch: 1n, membersLimit: 150n,
  bidDeadline: BigInt(terms.bidDeadline), refundDeadline: BigInt(terms.bidDeadline + 3_600_000), providerVkeys: terms.providerVkeys,
};

describe('provider keys', () => {
  it('are deterministic, distinct 32-byte ed25519 keys with seed-B payout addresses', () => {
    expect(providerKeys('provider-1', MNEMONIC).vkey).toBe(keys[0]!.vkey);
    expect(new Set(keys.map((k) => k.vkey)).size).toBe(3);
    for (const k of keys) {
      expect(k.vkey).toMatch(/^[0-9a-f]{64}$/);
      expect(k.address.startsWith('addr_test1q')).toBe(true);
    }
  });
});

describe('bid signing round trip', () => {
  it('a signed wire bid verifies with verifyBid and passes the bloc check', () => {
    keys.forEach((k, i) => {
      const sub = makeBid(BRANDS[i]!, k, terms, 1_480_000n, BigInt(NOW + 1_800_000));
      const bid = bidFromWire(JSON.parse(JSON.stringify(sub.bid)));
      expect(verifyBid(policy.hash, bid, sub.signature)).toBe(true);
      expect(checkBid(info, { bid, signature: sub.signature }, BigInt(NOW))).toEqual({ valid: true });
      expect(sub.provider).toMatch(/simulated/);
    });
  });
  it('fails for another campaign policy or a tampered price', () => {
    const sub = makeBid(BRANDS[0]!, keys[0]!, terms, 1_480_000n, BigInt(NOW + 1_800_000));
    const bid = bidFromWire(sub.bid);
    expect(verifyBid(blocScript(policy.hash).hash, bid, sub.signature)).toBe(false);
    expect(verifyBid(policy.hash, { ...bid, unitPrice: 1n }, sub.signature)).toBe(false);
    expect(blocAddress(blocScript(policy.hash).hash)).toMatch(/^addr_test1w/);
  });
});

describe('pricing', () => {
  it('respects floor and the pledge cap, applies quantity discounts, and lands near the 1.5 tADA median', () => {
    for (const b of BRANDS) {
      expect(listPrice(b, 100) < listPrice(b, 0)).toBe(true);
      for (const members of [0, 10, 60, 150]) {
        const p = quote(b, { members, bestRival: 1_000_000n, previous: 1_000_000n, maxUnitPrice: 3_000_000n });
        expect(p >= b.floor).toBe(true);
        expect(p <= 3_000_000n).toBe(true);
      }
      expect(quote(b, { members: 0, bestRival: null, previous: null, maxUnitPrice: 1_600_000n }) <= 1_600_000n).toBe(true);
    }
    const p = BRANDS.map((b) => quote(b, { members: 80, bestRival: 1_500_000n, previous: null, maxUnitPrice: 3_000_000n }));
    expect(p.every((x) => x >= 1_350_000n && x <= 2_100_000n)).toBe(true);
  });
});

describe('bidding loop', () => {
  it('reads /state + /campaign/terms and posts signed bids', async () => {
    const posted: unknown[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/state')) return json({ campaign: { state: 'open' }, bids: [] });
      if (u.endsWith('/campaign/terms')) return json(terms);
      if (u.endsWith('/bids')) {
        const sub = JSON.parse(String(init?.body));
        posted.push(sub);
        return json({ valid: checkBid(info, { bid: bidFromWire(sub.bid), signature: sub.signature }, BigInt(Date.now())).valid }, 201);
      }
      return json({}, 404);
    }) as typeof fetch;
    const bidder = new Bidder(BRANDS.map((brand, i) => ({ brand, keys: keys[i]!, last: null, lastResult: null })), 'http://bloc', fake);
    expect(await bidder.tick()).toBe(3);
    expect(bidder.agents.every((a) => a.lastResult?.includes('accepted'))).toBe(true);
    expect(await bidder.tick()).toBe(0); // unchanged prices are not re-posted
    expect(posted).toHaveLength(3);
  });
});
