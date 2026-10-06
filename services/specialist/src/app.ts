/**
 * HTTP surface (Fastify). Public: MIP-003 (/availability, /input_schema, /start_job, /status, /provide_input) and the
 * x402 paid route POST /x402/start_job. Localhost-only: /admin/*, /jobs (list), /evidence/*.
 * The paid handler records the job and returns; it never touches the chain (it runs before settle).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { CardanoExtraMasumi } from '@x402/cardano';
import { addressCredentials } from '@x402/cardano';
import { ESCROW_ADDRESS, NETWORK, runPaidRoute, SPECIALIST_PAID_PATH, taskInputHash, txUrl } from '@overpaid/cardano';
import type { SpecialistConfig } from './config.js';
import { JobBody, mip003Status, type Job } from './jobs.js';
import type { Offer } from './offer.js';
import type { JobStore } from './store.js';
import type { Watcher } from './watcher.js';

export interface AppDeps {
  cfg: SpecialistConfig;
  store: JobStore;
  offer: Offer;
  sellerAddress: string;
  /** null until BLOCKFROST_PROJECT_ID is set: chain-dependent admin actions answer 503. */
  watcher: Watcher | null;
  chainReady: boolean;
}

export function jobView(j: Job) {
  return {
    job_id: j.id,
    status: mip003Status(j.status),
    detail_status: j.status,
    identifier_from_purchaser: j.input.identifier_from_purchaser,
    input_hash: j.inputHash,
    onchain_input_hash: j.terms.onchainInputHash,
    blockchainIdentifier: j.terms.blockchainIdentifier,
    agentIdentifier: j.terms.agentIdentifier,
    sellerVKey: j.terms.sellerVKey,
    sellerAddress: j.terms.sellerAddress,
    payByTime: j.terms.payByTime,
    submitResultTime: j.terms.submitResultTime,
    unlockTime: j.terms.unlockTime,
    externalDisputeUnlockTime: j.terms.externalDisputeUnlockTime,
    amount: { lovelace: j.terms.amountLovelace, label: 'priced in tADA on preprod' },
    escrow: {
      address: ESCROW_ADDRESS, state: j.escrowState,
      lockTx: j.lockTx, lockTxUrl: txUrl(j.lockTx),
      resultTx: j.resultTx, resultTxUrl: j.resultTx ? txUrl(j.resultTx) : null,
      collectTx: j.collectTx, collectTxUrl: j.collectTx ? txUrl(j.collectTx) : null,
      refundAuthTx: j.refundAuthTx, closedBy: j.closedBy,
    },
    result: j.resultHash ? { result_hash: j.resultHash, outcome: j.work?.observedLabel ?? null, claim_id: j.work?.claimId ?? null, status_url: j.work?.statusUrl ?? null } : null,
    work: j.work ? { mode: j.work.mode, browser: j.work.browser, claim_id: j.work.claimId, observed: j.work.observedLabel, observed_at: j.work.observedAt } : null,
    error: j.error,
    events: j.events.slice(-20),
    first_party: true,
  };
}

const isLocal = (req: FastifyRequest) => {
  const ip = req.socket.remoteAddress ?? '';
  const forwarded = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['forwarded'];
  return !forwarded && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
};

function rateLimiter(perMinute: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= perMinute;
  };
}

export async function buildApp(deps: AppDeps) {
  const { cfg, store, offer } = deps;
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const allowQuote = rateLimiter(cfg.quoteRatePerMinute);

  const absUrl = (req: FastifyRequest) => `${cfg.publicUrl}${req.url}`;
  const plain = (req: FastifyRequest, body: unknown, pathOverride?: string) => ({
    method: req.method, path: pathOverride ?? req.url.split('?')[0]!, url: pathOverride ? `${cfg.publicUrl}${pathOverride}` : absUrl(req),
    headers: req.headers as Record<string, string | string[] | undefined>, query: req.query as Record<string, string>, body,
  });
  const send = (reply: FastifyReply, r: { status: number; headers: Record<string, string>; body: unknown }) => {
    for (const [k, v] of Object.entries(r.headers)) reply.header(k, v);
    return reply.code(r.status).send(r.body ?? {});
  };
  const localOnly = (req: FastifyRequest, reply: FastifyReply) => {
    if (!isLocal(req)) {
      void reply.code(403).send({ error: 'localhost only' });
      return false;
    }
    return true;
  };

  app.get('/healthz', async () => ({ ok: true, chainReady: deps.chainReady }));

  app.get('/availability', async () => ({
    status: 'available',
    type: 'masumi-agent',
    agentIdentifier: cfg.agentIdentifier ?? null,
    message: `${cfg.agentName}. Files airline delay-compensation claims (Skylane Air demo merchant). Paid via x402 masumi escrow on Cardano preprod.`,
  }));

  app.get('/input_schema', async () => ({
    input_data: [
      { id: 'merchant', type: 'option', name: 'Airline', data: { values: ['skylane'] }, validations: [{ validation: 'min', value: '1' }, { validation: 'max', value: '1' }] },
      { id: 'booking_ref', type: 'string', name: 'Booking reference', data: { placeholder: 'SKX7Q2' }, validations: [{ validation: 'format', value: '^[A-Z0-9]{6}$' }] },
      { id: 'passenger_name', type: 'string', name: 'Passenger name (as on ticket)', validations: [{ validation: 'min', value: '2' }] },
      { id: 'payout', type: 'option', name: 'Payout', data: { values: ['original_card', 'bank_transfer'] }, validations: [{ validation: 'optional', value: 'true' }] },
      { id: 'account_holder', type: 'string', name: 'Account holder (bank transfer only)', validations: [{ validation: 'optional', value: 'true' }] },
      { id: 'account_number', type: 'string', name: 'Account number / IBAN (bank transfer only)', validations: [{ validation: 'optional', value: 'true' }] },
    ],
  }));

  const validate = (body: unknown, reply: FastifyReply): JobBody | null => {
    const parsed = JobBody.safeParse(body);
    if (!parsed.success) {
      void reply.code(400).send({ error: 'invalid job body', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return null;
    }
    return parsed.data;
  };

  // x402 paid route: unpaid -> 402 with a fresh seller-signed Masumi quote; paid -> record job -> settle -> 200.
  app.post(SPECIALIST_PAID_PATH, async (req, reply) => {
    const body = validate(req.body, reply);
    if (!body) return reply;
    const paying = Boolean(req.headers['payment-signature'] || req.headers['x-payment']);
    if (!paying && !allowQuote(req.ip)) return reply.code(429).send({ error: 'too many quotes; slow down' });
    const r = await runPaidRoute(offer.http, plain(req, body), async ({ payload, txHash }) => {
      const extra = payload.accepted.extra as unknown as CardanoExtraMasumi;
      const t = extra.terms;
      // The job input is what the buyer paid for: the signed commitment content, not this request's body.
      const input = JobBody.parse(extra.inputCommitment.parts[0]!.content);
      const nowIso = new Date().toISOString();
      const job: Job = {
        id: randomUUID(), createdAt: nowIso, updatedAt: nowIso, status: 'awaiting_payment', error: null, input,
        inputHash: taskInputHash(input.input_data), lockTx: txHash,
        expected: {
          sellerAddress: t.sellerAddress, referenceKey: extra.referenceKey, referenceSignature: extra.referenceSignature,
          sellerNonce: t.sellerNonce, buyerNonce: t.buyerNonce, agentIdentifier: t.agentIdentifier ?? '', inputHash: t.inputHash,
          payByTime: t.payByTime, submitResultTime: t.submitResultTime, unlockTime: t.unlockTime, externalDisputeUnlockTime: t.externalDisputeUnlockTime,
          unit: payload.accepted.asset, amount: payload.accepted.amount, txHash,
        },
        terms: {
          blockchainIdentifier: extra.blockchainIdentifier, agentIdentifier: t.agentIdentifier ?? null,
          sellerVKey: addressCredentials(t.sellerAddress).payment.hash, sellerAddress: t.sellerAddress,
          identifierFromPurchaser: input.identifier_from_purchaser, onchainInputHash: t.inputHash,
          payByTime: Number(t.payByTime), submitResultTime: Number(t.submitResultTime), unlockTime: Number(t.unlockTime),
          externalDisputeUnlockTime: Number(t.externalDisputeUnlockTime), amountLovelace: payload.accepted.amount,
        },
        lock: null, work: null, resultHash: null, resultTx: null, collectTx: null, refundAuthTx: null, closedBy: null, escrowState: null,
        events: [{ at: nowIso, msg: `paid quote received; lock tx ${txHash} (facilitator will broadcast)` }],
      };
      const stored = await store.insertIfAbsent(job); // idempotent for retries of the same payment
      return { status: 200, body: jobView(stored) };
    });
    return send(reply, r);
  });

  // MIP-003 start_job: returns a quote for the x402 route (same issuer and quote store), in MIP-003 field names.
  // Payment happens only on POST /x402/start_job with the same body (the x402 request replaces start_job for payment).
  app.post('/start_job', async (req, reply) => {
    const body = validate(req.body, reply);
    if (!body) return reply;
    if (!allowQuote(req.ip)) return reply.code(429).send({ error: 'too many quotes; slow down' });
    const r = await runPaidRoute(offer.http, { ...plain(req, body, SPECIALIST_PAID_PATH), headers: { ...(req.headers as Record<string, string>), 'payment-signature': undefined, 'x-payment': undefined } }, async () => ({ status: 500, body: {} }));
    const header = r.headers['PAYMENT-REQUIRED'] ?? r.headers['payment-required'];
    if (r.status !== 402 || !header) return send(reply, r);
    const required = decodePaymentRequiredHeader(header);
    const req0 = required.accepts[0]!;
    const extra = req0.extra as unknown as CardanoExtraMasumi;
    const t = extra.terms;
    return reply.code(200).send({
      status: 'awaiting_payment',
      job_id: null,
      identifier_from_purchaser: body.identifier_from_purchaser,
      blockchainIdentifier: extra.blockchainIdentifier,
      payByTime: Number(t.payByTime), submitResultTime: Number(t.submitResultTime), unlockTime: Number(t.unlockTime),
      externalDisputeUnlockTime: Number(t.externalDisputeUnlockTime),
      agentIdentifier: t.agentIdentifier ?? null,
      sellerVKey: addressCredentials(t.sellerAddress).payment.hash,
      input_hash: taskInputHash(body.input_data),
      onchain_input_hash: t.inputHash,
      amounts: [{ amount: req0.amount, unit: 'lovelace' }],
      payment: { method: 'x402', network: NETWORK, transferMethod: 'masumi', url: `${cfg.publicUrl}${SPECIALIST_PAID_PATH}`, paymentRequired: header },
    });
  });

  app.get('/status', async (req, reply) => {
    const id = (req.query as { job_id?: string }).job_id;
    if (!id) return reply.code(400).send({ error: 'job_id is required' });
    const j = (await store.get(id).catch(() => null)) ?? (await store.byLockTx(id));
    if (!j) return reply.code(404).send({ error: 'job not found' });
    return jobView(j);
  });

  app.post('/provide_input', async (req, reply) => {
    const { job_id } = (req.body ?? {}) as { job_id?: string };
    if (!job_id) return reply.code(400).send({ error: 'job_id is required' });
    const j = await store.get(job_id);
    if (!j) return reply.code(404).send({ error: 'job not found' });
    return reply.code(409).send({ error: 'this job does not await input', status: mip003Status(j.status) });
  });

  app.get('/jobs/by-tx/:hash', async (req, reply) => {
    const j = await store.byLockTx((req.params as { hash: string }).hash);
    return j ? jobView(j) : reply.code(404).send({ error: 'job not found' });
  });
  app.get('/jobs/:id', async (req, reply) => {
    const j = await store.get((req.params as { id: string }).id);
    return j ? jobView(j) : reply.code(404).send({ error: 'job not found' });
  });
  app.get('/jobs', async (req, reply) => {
    if (!localOnly(req, reply)) return reply;
    return (await store.list(100)).map(jobView);
  });

  // Evidence bundle for the buyer's verification (localhost only: it carries the passenger's claim data).
  app.get('/evidence/:jobId/:file', async (req, reply) => {
    if (!localOnly(req, reply)) return reply;
    const { jobId, file } = req.params as { jobId: string; file: string };
    if (!/^[0-9a-f-]{36}$/.test(jobId) || !/^(manifest\.json|status\.json|result-hash\.txt|step-\d{2}\.png)$/.test(file)) return reply.code(400).send({ error: 'bad path' });
    try {
      const buf = await readFile(path.join(cfg.evidenceDir, jobId, file));
      return reply.type(file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : 'text/plain').send(buf);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  const adminJob = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!localOnly(req, reply)) return null;
    if (!deps.watcher) {
      void reply.code(503).send({ error: 'chain not configured: needs BLOCKFROST_PROJECT_ID' });
      return null;
    }
    const j = await store.get((req.params as { jobId: string }).jobId);
    if (!j) {
      void reply.code(404).send({ error: 'job not found' });
      return null;
    }
    return j;
  };

  app.post('/admin/collect/:jobId', async (req, reply) => {
    const j = await adminJob(req, reply);
    if (!j) return reply;
    try {
      const r = await deps.watcher!.collect(j);
      return r ? r : reply.code(409).send({ error: 'collect already running' });
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/admin/authorize-refund/:jobId', async (req, reply) => {
    const j = await adminJob(req, reply);
    if (!j) return reply;
    try {
      return await deps.watcher!.authorizeRefund(j);
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  return app;
}
