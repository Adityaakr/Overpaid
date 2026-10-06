/**
 * HTTP surface of services/bloc (Fastify).
 *   Public:  GET /healthz, GET /state, GET /events (SSE), GET /join-url, POST /join (custodial demo wallet), POST /bids,
 *            GET /campaign/terms, GET /x402/pledge-offer, GET /pledges?address=,
 *            POST /pledge/build, /pledge/submit, /refund/build, /refund/submit (non-custodial, CIP-30 signed)
 *   Admin:   POST /admin/campaign, /admin/simulate, /admin/settle, /admin/refund, /admin/join-tokens
 *            (header x-admin-token when BLOC_ADMIN_TOKEN is set; the service binds to 127.0.0.1 by default)
 * Chain-dependent routes answer 503 with `chainReason` until BLOCKFROST_PROJECT_ID and the seeds are present.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { txUrl } from '@overpaid/cardano';
import { makeEvent, type EventType } from '@overpaid/shared';
import type { BlocConfig } from './config.js';
import type { ChainOps } from './chain.js';
import { pledgeOffer } from './offer.js';
import type { CampaignRecord } from './store.js';
import { checkBid, chooseBestBid, chunkEven, compareOutRef, planSettlement, refKey, type RankedBid } from './planner.js';
import { pledgeDatumFor } from './offer.js';
import { mergeWitnesses, paymentKeyHashOf, parseUserUtxos, validatePledgeTx } from './usertx.js';
import { Assets, Transaction, TransactionHash } from '@evolution-sdk/evolution';
import type { BlocUtxos } from './chain.js';
import { campaignInfo, type BidRecord, type BlocStore, type PledgeRecord } from './store.js';
import { JoinTokens } from './tokens.js';
import { utxoRef } from './txs.js';
import { MAX_PLEDGE_LOVELACE, MIN_REFUND_RESERVE, MEMBERS_CAP, PLEDGE_LOCK_LOVELACE, tada } from './units.js';
import { bidFromWire, type BidSubmission } from './wire.js';

export interface AppDeps {
  cfg: BlocConfig;
  store: BlocStore;
  tokens?: JoinTokens;
  chain: ChainOps | null;
  chainReason: string | null;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
}

const BLOC_EVENTS: EventType[] = ['bloc.pledged', 'bloc.bid', 'bloc.settled'];
const iso = (ms: number) => new Date(ms).toISOString();

export async function buildApp(d: AppDeps) {
  const { cfg, store } = d;
  const tokens = d.tokens ?? new JoinTokens({ cap: MEMBERS_CAP, perIp: cfg.joinPerIp, file: cfg.tokensFile, usedWallets: store.data.pledges.map((p) => p.wallet) });
  const log = d.log ?? ((m: string) => console.log(`[bloc] ${m}`));
  const bus = new EventEmitter();
  bus.setMaxListeners(500);
  const emit = (type: EventType, data: Record<string, unknown>) => bus.emit('event', makeEvent(type, data));
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });

  const job = {
    busy: null as string | null, lastError: null as string | null, simOn: false, simTimer: null as NodeJS.Timeout | null,
    refundTimer: null as NodeJS.Timeout | null,
  };
  const nMax = () => store.data.nMax ?? cfg.nMax;
  /** Pledge refs spent by a tx we submitted recently: Blockfrost's UTxO index can lag, don't feed them into a new tx. */
  const recentlySpent = new Map<string, number>();
  const markSpent = (keys: Iterable<string>) => { const t = Date.now(); for (const k of keys) recentlySpent.set(k, t); };
  const isFresh = (k: string) => { const t = recentlySpent.get(k); return t !== undefined && Date.now() - t < 10 * 60_000; };
  /** Refund transactions carry no withdraw; keep them a little smaller than settlements. */
  const refundBatchSize = () => Math.max(1, Math.min(nMax(), 30));

  const joinUrl = () => (cfg.publicBaseUrl && store.data.campaign?.state === 'open' && tokens.remaining > 0 ? `${cfg.publicBaseUrl}/join?t=${tokens.current()}` : null);

  function stateView() {
    const c = store.data.campaign;
    const ps = store.data.pledges;
    const counted = ps.filter((p) => p.state !== 'invalid');
    return {
      campaign: c
        ? {
            id: c.id, item: c.item, asset: c.asset.label, unitLabel: c.unitLabel, membersLimit: c.membersLimit, minBatch: c.minBatch,
            bidDeadline: iso(c.bidDeadline), refundDeadline: iso(c.refundDeadline), campaignTx: c.campaignTx, scriptAddress: c.scriptAddress,
            state: c.state, marketPrice: Number(c.marketPrice),
          }
        : null,
      joinUrl: joinUrl(),
      nMax: store.data.nMax ?? cfg.nMax,
      pledges: {
        real: counted.filter((p) => !p.simulated).length,
        simulated: counted.filter((p) => p.simulated).length,
        lockedTotal: counted.filter((p) => p.state === 'submitted').reduce((s, p) => s + Number(p.locked), 0),
        recent: ps.slice(-20).reverse().map((p) => ({ id: p.id, label: p.label, simulated: p.simulated, via: p.via, txHash: p.txHash, at: iso(p.at) })),
      },
      bids: store.data.bids.slice(-50).reverse().map((b) => ({ id: b.id, provider: b.provider, unitPrice: Number(b.bid.unitPrice), strategy: b.strategy ?? null, valid: b.valid, at: iso(b.at) })),
      settlements: store.data.settlements.map((s) => ({ id: s.id, txHash: s.txHash, pledgeCount: s.pledgeCount, unitPrice: Number(s.unitPrice) })),
      chainReady: d.chain !== null,
      chainReason: d.chain ? null : d.chainReason,
    };
  }

  const needChain = (reply: FastifyReply): ChainOps | null => {
    if (d.chain) return d.chain;
    void reply.code(503).send({ error: d.chainReason ?? 'chain not configured', needs: ['BLOCKFROST_PROJECT_ID'] });
    return null;
  };

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith('/admin/') && cfg.adminToken && req.headers['x-admin-token'] !== cfg.adminToken) {
      return reply.code(401).send({ error: 'admin token required' });
    }
  });

  app.get('/healthz', async () => ({ ok: true, service: 'bloc', chainReady: d.chain !== null, chainReason: d.chain ? null : d.chainReason, job: job.busy, lastError: job.lastError }));
  app.get('/state', async () => stateView());
  app.get('/join-url', async () => ({ url: joinUrl() }));

  app.get('/campaign/terms', async (_req, reply) => {
    const c = store.data.campaign;
    if (!c) return reply.code(404).send({ error: 'no campaign' });
    return {
      id: c.id, state: c.state, policyId: c.policyId, blocId: c.blocIdHex, itemHash: c.itemHash, asset: { policy: c.asset.policy, name: c.asset.name },
      bidDeadline: c.bidDeadline, providerVkeys: c.providerVkeys, marketPrice: c.marketPrice, maxUnitPrice: MAX_PLEDGE_LOVELACE.toString(),
      members: store.data.pledges.filter((p) => p.state === 'submitted').length,
    };
  });

  app.get('/x402/pledge-offer', async (req, reply) => {
    const c = store.data.campaign;
    if (!c) return reply.code(404).send({ error: 'no campaign' });
    const refund = (req.query as { refundAddress?: string }).refundAddress;
    if (!refund) return reply.code(400).send({ error: 'refundAddress query parameter required' });
    try {
      return reply.code(402).send(pledgeOffer(c, refund));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/events', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify(stateView())}\n\n`);
    const onEvent = (ev: { type: string }) => reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    bus.on('event', onEvent);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', onEvent);
    });
  });

  // ------------------------------------------------------------------------------------------------ bids

  app.post('/bids', async (req, reply) => {
    const c = store.data.campaign;
    if (!c) return reply.code(409).send({ error: 'no campaign' });
    const body = req.body as BidSubmission;
    if (!body || typeof body.provider !== 'string' || !body.bid || typeof body.signature !== 'string') return reply.code(400).send({ error: 'expected { provider, strategy?, bid, signature }' });
    let parsed;
    try {
      parsed = bidFromWire(body.bid);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const now = d.chain ? await d.chain.tipMs().catch(() => BigInt(Date.now())) : BigInt(Date.now());
    const check = c.state === 'open' ? checkBid(campaignInfo(c), { bid: parsed, signature: body.signature }, now) : ({ valid: false, reason: `campaign is ${c.state}` } as const);
    const rec: BidRecord = {
      id: randomUUID(), provider: body.provider.slice(0, 60), strategy: body.strategy?.slice(0, 200), simulated: body.simulated ?? true,
      bid: body.bid, signature: body.signature, valid: check.valid, reason: check.valid ? null : check.reason, at: Date.now(),
    };
    store.addBid(rec);
    emit('bloc.bid', { id: rec.id, provider: rec.provider, unitPrice: Number(parsed.unitPrice), strategy: rec.strategy ?? null, valid: rec.valid, reason: rec.reason, simulated: rec.simulated });
    return reply.code(rec.valid ? 201 : 422).send({ id: rec.id, valid: rec.valid, reason: rec.reason });
  });

  // ------------------------------------------------------------------------------------------------ join

  app.post('/join', async (req, reply) => {
    const c = store.data.campaign;
    if (!c || c.state !== 'open') return reply.code(409).send({ error: 'no open bloc right now' });
    const chain = needChain(reply);
    if (!chain) return reply;
    const body = (req.body ?? {}) as { token?: string; nickname?: string };
    const r = tokens.consume(body.token, req.ip);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    const nickname = String(body.nickname ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || r.wallet;
    try {
      const p = await chain.pledgeFromWallet(r.wallet, c);
      const rec: PledgeRecord = {
        id: randomUUID(), label: nickname, simulated: false, wallet: r.wallet, refundAddress: p.address, txHash: p.txHash, outputIndex: p.outputIndex,
        quantity: 1, maxUnitPrice: MAX_PLEDGE_LOVELACE.toString(), locked: PLEDGE_LOCK_LOVELACE.toString(), via: 'custodial-demo', state: 'submitted', at: Date.now(),
      };
      store.addPledges([rec]);
      emit('bloc.pledged', { id: rec.id, label: rec.label, simulated: false, via: rec.via, txHash: rec.txHash, count: 1 });
      log(`room pledge ${r.wallet} (${nickname}) ${p.txHash}`);
      return {
        label: nickname, txHash: p.txHash, txUrl: txUrl(p.txHash), wallet: r.wallet, walletAddress: p.address, walletLabel: 'demo wallet funded by Overpaid',
        lockedLabel: `${tada(PLEDGE_LOCK_LOVELACE)} locked: up to ${tada(MAX_PLEDGE_LOVELACE)} for the eSIM plus a ${tada(MIN_REFUND_RESERVE)} reserve, the difference comes back`,
        state: 'submitted', via: 'custodial-demo',
      };
    } catch (e) {
      tokens.release(r.slot);
      return reply.code(502).send({ error: `pledge failed: ${(e as Error).message}` });
    }
  });

  // ------------------------------------------------------------------------------------------------ admin

  app.post('/admin/join-tokens', async (req) => {
    const count = Math.max(1, Math.min(Number((req.body as { count?: number } | undefined)?.count ?? 1), 200));
    const ts = tokens.issue(count);
    return { tokens: ts, urls: cfg.publicBaseUrl ? ts.map((t) => `${cfg.publicBaseUrl}/join?t=${t}`) : null, remaining: tokens.remaining };
  });

  app.post('/admin/campaign', async (req, reply) => {
    const chain = needChain(reply);
    if (!chain) return reply;
    if (job.busy) return reply.code(409).send({ error: `busy: ${job.busy}` });
    const b = (req.body ?? {}) as Partial<{ id: string; item: string; membersLimit: number; minBatch: number; bidMinutes: number; refundMinutes: number; providerVkeys: string[]; publishReferenceScript: boolean }>;
    let vkeys = b.providerVkeys;
    if (!vkeys?.length) {
      try {
        const r = await (d.fetchImpl ?? fetch)(`${cfg.providersUrl}/providers`, { signal: AbortSignal.timeout(5_000) });
        vkeys = ((await r.json()) as { providers: Array<{ vkey: string }> }).providers.map((p) => p.vkey);
      } catch (e) {
        return reply.code(502).send({ error: `could not read provider keys from ${cfg.providersUrl}/providers: ${(e as Error).message}` });
      }
    }
    if (!vkeys.length || vkeys.some((k) => !/^[0-9a-f]{64}$/i.test(k))) return reply.code(400).send({ error: 'providerVkeys must be 32-byte hex keys' });
    job.busy = 'campaign';
    try {
      const tip = Number(await chain.tipMs());
      const stamp = new Date(tip).toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const bidDeadline = tip + (b.bidMinutes ?? 90) * 60_000;
      const rec = await chain.createCampaign({
        id: (b.id ?? `esim-asia-${stamp}`).slice(0, 32), item: b.item ?? 'eSIM Asia 20 GB, monthly',
        membersLimit: b.membersLimit ?? MEMBERS_CAP, minBatch: b.minBatch ?? 1, bidDeadline,
        refundDeadline: Math.max(bidDeadline + 60_000, tip + (b.refundMinutes ?? 180) * 60_000), providerVkeys: vkeys.map((k) => k.toLowerCase()),
        publishReferenceScript: b.publishReferenceScript ?? true,
      });
      store.setCampaign(rec);
      log(`campaign ${rec.id} ${rec.campaignTx} at ${rec.scriptAddress}`);
      return { campaign: stateView().campaign, policyId: rec.policyId, txUrl: rec.campaignTx ? txUrl(rec.campaignTx) : null };
    } catch (e) {
      job.lastError = (e as Error).message;
      return reply.code(502).send({ error: job.lastError });
    } finally {
      job.busy = null;
    }
  });

  const simTick = async () => {
    const c = store.data.campaign;
    if (!job.simOn || !d.chain || !c || c.state !== 'open') return;
    const first = store.data.pledges.filter((p) => p.simulated).length + 1;
    try {
      const r = await d.chain.simulateBatch(c, first, cfg.simulateBatchSize);
      const now = Date.now();
      store.addPledges(r.outputs.map((o) => ({
        id: randomUUID(), label: `${o.sim} (simulated)`, simulated: true, wallet: o.sim, refundAddress: o.refundAddress, txHash: r.txHash, outputIndex: o.outputIndex,
        quantity: 1, maxUnitPrice: MAX_PLEDGE_LOVELACE.toString(), locked: PLEDGE_LOCK_LOVELACE.toString(), via: 'simulated-batch' as const, state: 'submitted' as const, at: now,
      })));
      emit('bloc.pledged', { simulated: true, count: r.outputs.length, txHash: r.txHash });
      log(`simulated batch of ${r.outputs.length} ${r.txHash}`);
      await d.chain.awaitTx(r.txHash); // next batch spends the change
    } catch (e) {
      job.lastError = `simulate: ${(e as Error).message}`;
      job.simOn = false;
      log(job.lastError);
      return;
    }
    if (job.simOn) job.simTimer = setTimeout(() => void simTick(), cfg.simulateIntervalMs);
  };

  app.post('/admin/simulate', async (req, reply) => {
    const on = Boolean((req.body as { on?: boolean } | undefined)?.on);
    if (on) {
      if (!needChain(reply)) return reply;
      if (!store.data.campaign || store.data.campaign.state !== 'open') return reply.code(409).send({ error: 'no open campaign' });
      if (!job.simOn) {
        job.simOn = true;
        void simTick();
      }
    } else {
      job.simOn = false;
      if (job.simTimer) clearTimeout(job.simTimer);
    }
    return { simulating: job.simOn, batchSize: cfg.simulateBatchSize, intervalMs: cfg.simulateIntervalMs, label: 'simulated pledgers (treasury-funded)' };
  });

  const pauseSim = () => {
    const was = job.simOn;
    job.simOn = false;
    if (job.simTimer) clearTimeout(job.simTimer);
    return was;
  };
  const resumeSim = (was: boolean) => {
    if (was && store.data.campaign?.state === 'open' && !job.simOn) {
      job.simOn = true;
      void simTick();
    }
  };

  app.post('/admin/settle', async (req, reply) => {
    // Optional cap: settle at most `limit` pledges now (e.g. exactly N_max in one transaction); the rest stay pledged.
    const limit = Number((req.body as { limit?: number } | null)?.limit ?? 0) || 0;
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c || c.state !== 'open') return reply.code(409).send({ error: 'no open campaign' });
    if (job.busy) return reply.code(409).send({ error: `busy: ${job.busy}` });
    job.busy = 'settle'; // synchronously after the check: no await gap for a second request to slip through
    let started = false;
    try {
      const info = campaignInfo(c);
      const tip = await chain.tipMs();
      const ranked: Array<RankedBid & { rec: BidRecord }> = [];
      for (const b of store.data.bids) {
        try {
          ranked.push({ id: b.id, valid: b.valid, at: b.at, bid: bidFromWire(b.bid), signature: b.signature, rec: b });
        } catch {
          /* stored invalid */
        }
      }
      const u = await chain.readBloc(c, info);
      const eligible = u.valid.map((v) => v.pledge);
      const considered = limit ? eligible.slice(0, limit) : eligible;
      // The bid (and the bid deadline) must outlive every batch: ~300 s per batch (build, submit, confirm) + 2 min.
      const estBatches = Math.max(1, Math.ceil(considered.length / nMax()));
      const best = chooseBestBid(ranked, info, tip, BigInt(estBatches * 300_000 + 120_000));
      if (!best) return reply.code(409).send({ error: `no valid bid that stays unexpired for ${estBatches} batch(es)` });
      const plan = planSettlement(info, considered, best.bid.unitPrice, { nMax: nMax() });
      if (!plan.batches.length) return reply.code(409).send({ error: 'no eligible pledges', skipped: plan.skipped.length });
      store.markPledges(new Set(u.invalid.map((x) => refKey(utxoRef(x.utxo)))), 'invalid', 'failed datum/value validation');
      store.patchCampaign({ state: 'settling' });
      const simWas = pauseSim();
      started = true;
      void (async () => {
        try {
          for (const batch of plan.batches) {
            // Re-read the chain before every batch: the previous batch spent wallet UTxOs this one must not reuse.
            const fresh = batch === plan.batches[0] ? u : await chain.readBloc(c, info);
            const txHash = await chain.settle(c, fresh, batch, best.bid, best.signature);
            markSpent(batch.pledges.map((p) => refKey(p.ref)));
            store.addSettlement({ id: randomUUID(), txHash, pledgeCount: batch.pledges.length, unitPrice: best.bid.unitPrice.toString(), bidId: best.id, kind: 'settle', at: Date.now() });
            store.markPledges(new Set(batch.pledges.map((p) => refKey(p.ref))), 'settled', undefined, { settlementTxHash: txHash });
            emit('bloc.settled', { txHash, txUrl: txUrl(txHash), pledgeCount: batch.pledges.length, unitPrice: Number(best.bid.unitPrice), provider: best.rec.provider, providerTotal: Number(batch.providerTotal) });
            log(`settled ${batch.pledges.length} pledges at ${best.bid.unitPrice} lovelace: ${txHash}`);
            await chain.awaitTx(txHash);
          }
          store.patchCampaign({ state: limit && eligible.length > limit ? 'open' : 'settled' });
        } catch (e) {
          job.lastError = `settle: ${(e as Error).message}`;
          store.patchCampaign({ state: 'open' });
          log(job.lastError);
        } finally {
          job.busy = null;
          resumeSim(simWas);
        }
      })();
      return reply.code(202).send({
        bid: { id: best.id, provider: best.rec.provider, unitPrice: Number(best.bid.unitPrice) },
        batches: plan.batches.map((b) => b.pledges.length), skipped: plan.skipped.length, invalid: u.invalid.length,
      });
    } catch (e) {
      job.lastError = `settle: ${(e as Error).message}`;
      return reply.code(502).send({ error: job.lastError });
    } finally {
      if (!started) job.busy = null;
    }
  });

  // ------------------------------------------------------------------------------------------------ refunds (bloc-admin pays)

  class NotYet extends Error {}

  /** Read the bloc address and cut every refundable pledge (datum parses as a PledgeDatum) into batches. Caller holds job.busy. */
  async function prepareRefund(chain: ChainOps, c: CampaignRecord) {
    const tip = await chain.tipMs();
    if (tip <= BigInt(c.refundDeadline) + 2_000n) throw new NotYet(`refund deadline ${iso(c.refundDeadline)} not reached on chain`);
    const u = await chain.readBloc(c, campaignInfo(c));
    const sorted = u.refundable.filter((x) => !isFresh(refKey(x.pledge.ref))).sort((a, b) => compareOutRef(a.pledge.ref, b.pledge.ref));
    return { u, batches: chunkEven(sorted, refundBatchSize()) };
  }

  /** Submit the batches one by one. Never leaves the campaign in 'refunding'. Caller holds job.busy; released here. */
  async function executeRefund(chain: ChainOps, c: CampaignRecord, u: BlocUtxos, batches: BlocUtxos['refundable'][]): Promise<string[]> {
    const prev = c.state === 'refunding' ? 'open' : c.state;
    const hashes: string[] = [];
    try {
      if (batches.length) store.patchCampaign({ state: 'refunding' });
      for (const batch of batches) {
        const txHash = await chain.refund(c, u, batch);
        hashes.push(txHash);
        markSpent(batch.map((p) => refKey(p.pledge.ref)));
        store.addSettlement({ id: randomUUID(), txHash, pledgeCount: batch.length, unitPrice: '0', bidId: '', kind: 'refund', at: Date.now() });
        store.markPledges(new Set(batch.map((p) => refKey(p.pledge.ref))), 'refunded', undefined, { refundTxHash: txHash });
        emit('bloc.settled', { kind: 'refund', txHash, txUrl: txUrl(txHash), pledgeCount: batch.length });
        log(`refunded ${batch.length} pledges: ${txHash}`);
        if (!(await chain.awaitTx(txHash))) throw new Error(`refund ${txHash} not confirmed in time`);
      }
      // Blockfrost's UTxO index can lag the confirmation: don't count what this run just spent.
      const left = batches.length ? (await chain.readBloc(c, campaignInfo(c))).refundable.filter((x) => !isFresh(refKey(x.pledge.ref))).length : 0;
      if (store.data.campaign?.id === c.id) store.patchCampaign({ state: left ? prev : 'refunded' });
      return hashes;
    } catch (e) {
      job.lastError = `refund: ${(e as Error).message}`;
      log(job.lastError);
      if (store.data.campaign?.id === c.id) store.patchCampaign({ state: prev });
      throw e;
    } finally {
      job.busy = null;
    }
  }

  app.post('/admin/refund', async (_req, reply) => {
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c) return reply.code(409).send({ error: 'no campaign' });
    if (job.busy) return reply.code(409).send({ error: `busy: ${job.busy}` });
    job.busy = 'refund';
    let prepared;
    try {
      prepared = await prepareRefund(chain, c);
    } catch (e) {
      job.busy = null;
      return reply.code(e instanceof NotYet ? 409 : 502).send({ error: (e as Error).message });
    }
    void executeRefund(chain, c, prepared.u, prepared.batches).catch(() => {});
    return reply.code(202).send({ batches: prepared.batches.map((b) => b.length) });
  });

  /** Automatic refunds: once the chain is past refund_deadline, return every remaining pledge. Returns tx hashes (or null if skipped). */
  async function autoRefundTick(): Promise<string[] | null> {
    const chain = d.chain;
    const c = store.data.campaign;
    if (!chain || !c || !['open', 'settling', 'refunding'].includes(c.state)) return null;
    if (job.busy) return null;
    job.busy = 'auto-refund';
    let prepared;
    try {
      prepared = await prepareRefund(chain, c);
    } catch (e) {
      job.busy = null;
      if (!(e instanceof NotYet)) {
        job.lastError = `auto-refund: ${(e as Error).message}`;
        log(job.lastError);
      }
      return null;
    }
    return executeRefund(chain, c, prepared.u, prepared.batches).catch(() => null);
  }
  if (cfg.autoRefundMs > 0 && d.chain) {
    job.refundTimer = setInterval(() => void autoRefundTick(), cfg.autoRefundMs);
    job.refundTimer.unref();
  }

  /** Boot: a crash mid-settle/refund leaves 'settling'/'refunding' in the snapshot; re-derive the state from the chain. */
  async function reconcile(): Promise<string | null> {
    const c = store.data.campaign;
    if (!d.chain || !c || (c.state !== 'settling' && c.state !== 'refunding')) return null;
    const u = await d.chain.readBloc(c, campaignInfo(c));
    const next = u.refundable.length ? 'open' : store.data.settlements.some((s) => s.kind === 'settle') ? 'settled' : 'refunded';
    store.patchCampaign({ state: next });
    log(`reconciled campaign ${c.id}: ${c.state} -> ${next} (${u.refundable.length} pledge UTxOs at the script)`);
    return next;
  }

  // ------------------------------------------------------------------------------------------------ non-custodial (CIP-30)

  const bad = (reply: FastifyReply, e: unknown, code = 400) => reply.code(code).send({ error: (e as Error).message ?? String(e) });
  const cleanNick = (n: unknown, fallback: string) => String(n ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24) || fallback;

  /** Open campaign still accepting pledges per the chain clock, or an error reply. */
  async function pledgeWindow(reply: FastifyReply): Promise<{ chain: ChainOps; c: CampaignRecord } | null> {
    const chain = needChain(reply);
    if (!chain) return null;
    const c = store.data.campaign;
    if (!c || c.state !== 'open') {
      void reply.code(409).send({ error: 'no open bloc right now' });
      return null;
    }
    const tip = await chain.tipMs();
    if (tip >= BigInt(c.bidDeadline) - 60_000n) {
      void reply.code(409).send({ error: `pledging closed: the bid deadline ${iso(c.bidDeadline)} has passed` });
      return null;
    }
    return { chain, c };
  }

  app.post('/pledge/build', async (req, reply) => {
    const body = (req.body ?? {}) as { address?: unknown; utxos?: unknown };
    if (typeof body.address !== 'string') return reply.code(400).send({ error: 'expected { address, utxos }' });
    let utxos;
    try {
      paymentKeyHashOf(body.address);
      utxos = parseUserUtxos(body.utxos);
    } catch (e) {
      return bad(reply, e);
    }
    const total = utxos.reduce((s, u) => s + Assets.lovelaceOf(u.assets), 0n);
    if (total < PLEDGE_LOCK_LOVELACE + 1_000_000n) return reply.code(400).send({ error: `wallet needs at least ${tada(PLEDGE_LOCK_LOVELACE + 1_000_000n)} in plain UTxOs (has ${tada(total)})` });
    const w = await pledgeWindow(reply);
    if (!w) return reply;
    try {
      const { txCbor } = await w.chain.buildUserPledge(w.c, body.address, utxos, pledgeDatumFor(w.c, body.address));
      return { txCbor, lockedLovelace: Number(PLEDGE_LOCK_LOVELACE), refundAddress: body.address };
    } catch (e) {
      return bad(reply, new Error(`could not build the pledge: ${(e as Error).message}`), 502);
    }
  });

  app.post('/pledge/submit', async (req, reply) => {
    const body = (req.body ?? {}) as { txCbor?: unknown; witnessSet?: unknown; nickname?: unknown };
    if (typeof body.txCbor !== 'string' || typeof body.witnessSet !== 'string') return reply.code(400).send({ error: 'expected { txCbor, witnessSet, nickname }' });
    const w = await pledgeWindow(reply);
    if (!w) return reply;
    let signed: string, check;
    try {
      signed = mergeWitnesses(body.txCbor, body.witnessSet);
      check = validatePledgeTx(signed, w.c);
    } catch (e) {
      return bad(reply, e, 422);
    }
    if (store.data.pledges.some((p) => p.txHash === check.txHash)) return reply.code(409).send({ error: 'this pledge was already submitted' });
    let txHash: string;
    try {
      txHash = await w.chain.submitSigned(signed);
    } catch (e) {
      return bad(reply, e, 502);
    }
    const label = cleanNick(body.nickname, `${check.refundAddress.slice(0, 12)}...`);
    const rec: PledgeRecord = {
      id: randomUUID(), label, simulated: false, wallet: null, refundAddress: check.refundAddress, txHash, outputIndex: check.outputIndex,
      quantity: 1, maxUnitPrice: check.datum.maxUnitPrice.toString(), locked: check.lockedLovelace.toString(), via: 'cip30', state: 'submitted', at: Date.now(),
    };
    store.addPledges([rec]);
    emit('bloc.pledged', { id: rec.id, label, simulated: false, via: 'cip30', txHash, count: 1 });
    log(`cip30 pledge (${label}) ${txHash}`);
    return { txHash, txUrl: txUrl(txHash), label };
  });

  const REF_RE = /^([0-9a-f]{64})#(\d{1,4})$/i;

  app.post('/refund/build', async (req, reply) => {
    const body = (req.body ?? {}) as { ref?: unknown; address?: unknown; utxos?: unknown };
    const m = typeof body.ref === 'string' ? REF_RE.exec(body.ref) : null;
    if (!m || typeof body.address !== 'string') return reply.code(400).send({ error: 'expected { ref: "txhash#ix", address, utxos }' });
    let utxos;
    try {
      paymentKeyHashOf(body.address);
      utxos = parseUserUtxos(body.utxos);
    } catch (e) {
      return bad(reply, e);
    }
    const total = utxos.reduce((sum, u) => sum + Assets.lovelaceOf(u.assets), 0n);
    if (total < 3_500_000n) return reply.code(400).send({ error: `a refund needs about ${tada(3_500_000n)} in plain UTxOs for collateral and fee (wallet has ${tada(total)})` });
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c) return reply.code(409).send({ error: 'no campaign' });
    const tip = await chain.tipMs();
    if (tip <= BigInt(c.refundDeadline) + 2_000n) return reply.code(409).send({ error: `refunds open after the refund deadline ${iso(c.refundDeadline)}` });
    try {
      const u = await chain.readBloc(c, campaignInfo(c));
      const key = `${m[1]!.toLowerCase()}#${Number(m[2])}`;
      const p = isFresh(key) ? undefined : u.refundable.find((x) => refKey(x.pledge.ref) === key);
      if (!p) return reply.code(404).send({ error: `no refundable pledge ${key} at the bloc address (already refunded or settled?)` });
      const { txCbor } = await chain.buildUserRefund(c, u, p, body.address, utxos);
      const { plutusAddressToBech32 } = await import('@overpaid/bloc-contract');
      return { txCbor, refundAddress: plutusAddressToBech32(p.pledge.datum.memberRefundAddress, 0), lovelace: Number(p.pledge.lovelace) };
    } catch (e) {
      return bad(reply, new Error(`could not build the refund: ${(e as Error).message}`), 502);
    }
  });

  app.post('/refund/submit', async (req, reply) => {
    const body = (req.body ?? {}) as { txCbor?: unknown; witnessSet?: unknown };
    if (typeof body.txCbor !== 'string' || typeof body.witnessSet !== 'string') return reply.code(400).send({ error: 'expected { txCbor, witnessSet }' });
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c) return reply.code(409).send({ error: 'no campaign' });
    let signed: string, spent: Set<string>;
    try {
      signed = mergeWitnesses(body.txCbor, body.witnessSet);
      const tx = Transaction.fromCBORHex(signed);
      spent = new Set(tx.body.inputs.map((i) => `${TransactionHash.toHex(i.transactionId)}#${Number(i.index)}`));
    } catch (e) {
      return bad(reply, e, 422);
    }
    let refs: string[];
    try {
      const u = await chain.readBloc(c, campaignInfo(c));
      refs = u.refundable.map((x) => refKey(x.pledge.ref)).filter((k) => spent.has(k));
    } catch (e) {
      return bad(reply, e, 502);
    }
    if (!refs.length) return reply.code(422).send({ error: 'this transaction does not spend any pledge of this bloc' });
    let txHash: string;
    try {
      txHash = await chain.submitSigned(signed);
    } catch (e) {
      return bad(reply, e, 502);
    }
    store.addSettlement({ id: randomUUID(), txHash, pledgeCount: refs.length, unitPrice: '0', bidId: '', kind: 'refund', at: Date.now() });
    markSpent(refs);
    store.markPledges(new Set(refs), 'refunded', undefined, { refundTxHash: txHash });
    emit('bloc.settled', { kind: 'refund', txHash, txUrl: txUrl(txHash), pledgeCount: refs.length, selfService: true });
    return { txHash, txUrl: txUrl(txHash) };
  });

  app.get('/pledges', async (req, reply) => {
    const address = (req.query as { address?: string }).address;
    if (!address) return reply.code(400).send({ error: 'address query parameter required' });
    const c = store.data.campaign;
    return store.data.pledges
      .filter((p) => p.refundAddress === address)
      .map((p) => ({
        id: p.id, label: p.label, via: p.via, txHash: p.txHash, outputIndex: p.outputIndex, state: p.state, lockedLovelace: Number(p.locked),
        settlementTxHash: p.settlementTxHash ?? null, refundTxHash: p.refundTxHash ?? null, campaignId: c?.id ?? null, refundDeadline: c ? iso(c.refundDeadline) : null,
      }));
  });

  app.addHook('onClose', async () => {
    job.simOn = false;
    if (job.simTimer) clearTimeout(job.simTimer);
    if (job.refundTimer) clearInterval(job.refundTimer);
  });

  const extras: BlocExtras = { tokens, emit, events: BLOC_EVENTS, stateView, autoRefundTick, reconcile, job };
  return Object.assign(app, { bloc: extras });
}

export interface BlocExtras {
  tokens: JoinTokens;
  emit: (type: EventType, data: Record<string, unknown>) => boolean;
  events: EventType[];
  stateView: () => unknown;
  /** One auto-refund pass; tx hashes, or null when nothing ran. */
  autoRefundTick: () => Promise<string[] | null>;
  /** Boot reconciliation of a 'settling'/'refunding' snapshot against the chain. */
  reconcile: () => Promise<string | null>;
  job: { busy: string | null; lastError: string | null };
}

/** The extras attached to the Fastify app (a Fastify instance is thenable, so `await buildApp()` loses them in the type). */
export const blocOf = (app: object): BlocExtras => (app as { bloc: BlocExtras }).bloc;
