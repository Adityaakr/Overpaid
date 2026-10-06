import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { ChainOps } from '../src/chain.js';
import { BlocStore, type CampaignRecord } from '../src/store.js';
import { bidToWire } from '../src/wire.js';
import { BLOC, BLOC_ADDRESS, BLOC_ID, CAMPAIGN, ITEM_HASH, NOW, POLICY, SEED, VK, bidFor } from './fixtures.js';

const record: CampaignRecord = {
  id: 'esim-eu-30d', item: 'eSIM Europe 30-day 10GB', itemHash: ITEM_HASH, asset: { policy: '', name: '', label: 'tADA' }, unitLabel: 'u',
  membersLimit: 150, minBatch: 1, bidDeadline: Number(CAMPAIGN.bidDeadline), refundDeadline: Number(CAMPAIGN.refundDeadline),
  providerVkeys: VK.slice(0, 3), policyId: POLICY.hash, blocHash: BLOC.hash, blocIdHex: BLOC_ID, seed: SEED, campaignTx: 'aa'.repeat(32),
  scriptAddress: BLOC_ADDRESS, state: 'open', marketPrice: '2400000', createdAt: 0,
};

const fakeChain = (): ChainOps => ({
  tipMs: async () => NOW,
  createCampaign: async () => record,
  pledgeFromWallet: async (w) => ({ txHash: 'bb'.repeat(32), outputIndex: 0, address: `addr_test_${w}` }),
  simulateBatch: async () => ({ txHash: 'cc'.repeat(32), outputs: [] }),
  readBloc: async () => { throw new Error('n/a'); },
  settle: async () => 'dd'.repeat(32),
  refund: async () => 'ee'.repeat(32),
  awaitTx: async () => true,
});

async function setup(chain: ChainOps | null) {
  const cfg = { ...loadConfig({}), stateFile: null, publicBaseUrl: 'https://room.example' };
  const store = new BlocStore(null);
  const app = await buildApp({ cfg, store, chain, chainReason: chain ? null : 'needs BLOCKFROST_PROJECT_ID', log: () => {} });
  return { app, store };
}

describe('bloc HTTP', () => {
  it('GET /state has exactly the agreed shape, chain guarded without a key', async () => {
    const { app, store } = await setup(null);
    let s = (await app.inject({ method: 'GET', url: '/state' })).json();
    expect(Object.keys(s).sort()).toEqual(['bids', 'campaign', 'chainReady', 'chainReason', 'joinUrl', 'nMax', 'pledges', 'settlements']);
    expect(s).toMatchObject({ campaign: null, joinUrl: null, nMax: 40, chainReady: false, chainReason: 'needs BLOCKFROST_PROJECT_ID' });
    expect(Object.keys(s.pledges).sort()).toEqual(['lockedTotal', 'real', 'recent', 'simulated']);
    expect((await app.inject({ method: 'POST', url: '/admin/campaign', payload: {} })).statusCode).toBe(503);
    store.setCampaign(record);
    s = (await app.inject({ method: 'GET', url: '/state' })).json();
    expect(Object.keys(s.campaign).sort()).toEqual(['asset', 'bidDeadline', 'campaignTx', 'id', 'item', 'marketPrice', 'membersLimit', 'minBatch', 'refundDeadline', 'scriptAddress', 'state', 'unitLabel']);
    expect(s.joinUrl).toMatch(/^https:\/\/room\.example\/join\?t=/);
    expect((await app.inject({ method: 'POST', url: '/join', payload: { token: 'x', nickname: 'a' } })).statusCode).toBe(503);
    await app.close();
  });

  it('POST /bids stores valid and invalid bids', async () => {
    const { app, store } = await setup(fakeChain());
    store.setCampaign(record);
    const ok = bidFor(0, 1_500_000n);
    const r1 = await app.inject({ method: 'POST', url: '/bids', payload: { provider: 'P1', strategy: 's', bid: bidToWire(ok.bid), signature: ok.signature } });
    expect(r1.statusCode).toBe(201);
    const bad = bidFor(3, 1_000_000n);
    const r2 = await app.inject({ method: 'POST', url: '/bids', payload: { provider: 'P4', bid: bidToWire(bad.bid), signature: bad.signature } });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().reason).toMatch(/allowlist/);
    const s = (await app.inject({ method: 'GET', url: '/state' })).json();
    expect(s.bids.map((b: { valid: boolean }) => b.valid)).toEqual([false, true]);
    expect(s.bids[1]).toMatchObject({ provider: 'P1', unitPrice: 1_500_000, strategy: 's' });
    await app.close();
  });

  it('POST /join consumes a one-time token and records a real pledge', async () => {
    const { app } = await setup(fakeChain());
    await app.inject({ method: 'POST', url: '/admin/campaign', payload: { providerVkeys: VK.slice(0, 3) } });
    const { tokens } = (await app.inject({ method: 'POST', url: '/admin/join-tokens', payload: { count: 2 } })).json();
    const r = await app.inject({ method: 'POST', url: '/join', payload: { token: tokens[0], nickname: 'Ada <b>' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ label: 'Ada b', wallet: 'room-001', state: 'submitted', txHash: 'bb'.repeat(32) });
    expect((await app.inject({ method: 'POST', url: '/join', payload: { token: tokens[0] } })).statusCode).toBe(409);
    const s = (await app.inject({ method: 'GET', url: '/state' })).json();
    expect(s.pledges).toMatchObject({ real: 1, simulated: 0, lockedTotal: 4_500_000 });
    const offer = await app.inject({ method: 'GET', url: `/x402/pledge-offer?refundAddress=${encodeURIComponent('addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp')}` });
    expect(offer.statusCode).toBe(402);
    expect(offer.json().accepts[0]).toMatchObject({ scheme: 'exact', network: 'cardano:preprod', payTo: BLOC_ADDRESS, extra: { assetTransferMethod: 'script' } });
    await app.close();
  });
});
