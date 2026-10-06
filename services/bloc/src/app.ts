/**
 * HTTP surface of services/bloc (Fastify).
 *   Public:  GET /healthz, GET /state, GET /events (SSE), GET /join-url, POST /join, POST /bids, GET /campaign/terms,
 *            GET /x402/pledge-offer
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
import { checkBid, chooseBestBid, planRefunds, planSettlement, refKey, type RankedBid } from './planner.js';
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
  const tokens = d.tokens ?? new JoinTokens({ cap: MEMBERS_CAP, perIp: cfg.joinPerIp });
  const log = d.log ?? ((m: string) => console.log(`[bloc] ${m}`));
  const bus = new EventEmitter();
  bus.setMaxListeners(500);
  const emit = (type: EventType, data: Record<string, unknown>) => bus.emit('event', makeEvent(type, data));
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 64 * 1024 });

  const job = { busy: null as string | null, lastError: null as string | null, simOn: false, simTimer: null as NodeJS.Timeout | null };

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
        recent: ps.slice(-20).reverse().map((p) => ({ id: p.id, label: p.label, simulated: p.simulated, txHash: p.txHash, at: iso(p.at) })),
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
        quantity: 1, maxUnitPrice: MAX_PLEDGE_LOVELACE.toString(), locked: PLEDGE_LOCK_LOVELACE.toString(), via: 'direct-submit', state: 'submitted', at: Date.now(),
      };
      store.addPledges([rec]);
      emit('bloc.pledged', { id: rec.id, label: rec.label, simulated: false, txHash: rec.txHash, count: 1 });
      log(`room pledge ${r.wallet} (${nickname}) ${p.txHash}`);
      return {
        label: nickname, txHash: p.txHash, txUrl: txUrl(p.txHash), wallet: r.wallet, walletAddress: p.address, walletLabel: 'demo wallet funded by Overpaid',
        lockedLabel: `${tada(PLEDGE_LOCK_LOVELACE)} locked: up to ${tada(MAX_PLEDGE_LOVELACE)} for the eSIM plus a ${tada(MIN_REFUND_RESERVE)} reserve, the difference comes back`,
        state: 'submitted', via: 'direct-submit (x402 script offer format)',
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
        id: (b.id ?? `esim-eu-${stamp}`).slice(0, 32), item: b.item ?? 'eSIM Europe 30-day 10GB',
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

  app.post('/admin/settle', async (_req, reply) => {
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c || c.state !== 'open') return reply.code(409).send({ error: 'no open campaign' });
    if (job.busy) return reply.code(409).send({ error: `busy: ${job.busy}` });
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
    const best = chooseBestBid(ranked, info, tip);
    if (!best) return reply.code(409).send({ error: 'no valid, unexpired bid to settle with' });
    const u = await chain.readBloc(c, info);
    const plan = planSettlement(info, u.valid.map((v) => v.pledge), best.bid.unitPrice, { nMax: store.data.nMax ?? cfg.nMax });
    if (!plan.batches.length) return reply.code(409).send({ error: 'no eligible pledges', skipped: plan.skipped.length });
    store.markPledges(new Set(u.invalid.map((x) => refKey(utxoRef(x.utxo)))), 'invalid', 'failed datum/value validation');
    job.busy = 'settle';
    store.patchCampaign({ state: 'settling' });
    void (async () => {
      try {
        for (const batch of plan.batches) {
          const txHash = await chain.settle(c, u, batch, best.bid, best.signature);
          store.addSettlement({ id: randomUUID(), txHash, pledgeCount: batch.pledges.length, unitPrice: best.bid.unitPrice.toString(), bidId: best.id, kind: 'settle', at: Date.now() });
          store.markPledges(new Set(batch.pledges.map((p) => refKey(p.ref))), 'settled');
          emit('bloc.settled', { txHash, txUrl: txUrl(txHash), pledgeCount: batch.pledges.length, unitPrice: Number(best.bid.unitPrice), provider: best.rec.provider, providerTotal: Number(batch.providerTotal) });
          log(`settled ${batch.pledges.length} pledges at ${best.bid.unitPrice} lovelace: ${txHash}`);
          await chain.awaitTx(txHash);
        }
        store.patchCampaign({ state: 'settled' });
      } catch (e) {
        job.lastError = `settle: ${(e as Error).message}`;
        store.patchCampaign({ state: 'open' });
        log(job.lastError);
      } finally {
        job.busy = null;
      }
    })();
    return reply.code(202).send({
      bid: { id: best.id, provider: best.rec.provider, unitPrice: Number(best.bid.unitPrice) },
      batches: plan.batches.map((b) => b.pledges.length), skipped: plan.skipped.length, invalid: u.invalid.length,
    });
  });

  app.post('/admin/refund', async (_req, reply) => {
    const chain = needChain(reply);
    if (!chain) return reply;
    const c = store.data.campaign;
    if (!c) return reply.code(409).send({ error: 'no campaign' });
    if (job.busy) return reply.code(409).send({ error: `busy: ${job.busy}` });
    const tip = await chain.tipMs();
    const info = campaignInfo(c);
    if (tip <= info.refundDeadline + 2_000n) return reply.code(409).send({ error: `refund deadline ${iso(c.refundDeadline)} not reached on chain` });
    const u = await chain.readBloc(c, info);
    const batches = planRefunds(u.valid.map((v) => v.pledge), tip, info, store.data.nMax ?? cfg.nMax);
    job.busy = 'refund';
    store.patchCampaign({ state: 'refunding' });
    void (async () => {
      try {
        for (const batch of batches) {
          const txHash = await chain.refund(c, u, batch);
          store.addSettlement({ id: randomUUID(), txHash, pledgeCount: batch.length, unitPrice: '0', bidId: '', kind: 'refund', at: Date.now() });
          store.markPledges(new Set(batch.map((p) => refKey(p.ref))), 'refunded');
          emit('bloc.settled', { kind: 'refund', txHash, txUrl: txUrl(txHash), pledgeCount: batch.length });
          await chain.awaitTx(txHash);
        }
        store.patchCampaign({ state: 'refunded' });
      } catch (e) {
        job.lastError = `refund: ${(e as Error).message}`;
        log(job.lastError);
      } finally {
        job.busy = null;
      }
    })();
    return reply.code(202).send({ batches: batches.map((b) => b.length) });
  });

  app.addHook('onClose', async () => {
    job.simOn = false;
    if (job.simTimer) clearTimeout(job.simTimer);
  });

  return Object.assign(app, { bloc: { tokens, emit, events: BLOC_EVENTS, stateView } });
}
