import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, hires, inArray, opportunities, recoveries, tasks, type Db } from '@overpaid/db';
import { DEMO_USER, PORTS, SKYLANE_FLIGHT, hashCanonical, merchantUrl, newId } from '@overpaid/shared';
import type { Bus } from '../bus.js';
import {
  ACTIVE_HIRE_STATES, ESCROW_FROM_JOB, activeHireFor, disputeBlocked, nextHireState, shouldAutoDispute, shouldVerify,
  shouldWithdrawRefund, stateFromChain, taskEffect, type ChainView,
} from '../hireLogic.js';

const SPECIALIST_URL = process.env.SPECIALIST_URL ?? `http://127.0.0.1:${PORTS.specialist}`;
const CHAIN_CHECK_MS = 20_000;
const VERIFY_RETRY_MS = 10_000;
const SETTLEMENT_GIVE_UP_MS = 10 * 60_000;

type Job = {
  id: string;
  status: string;
  error: string | null;
  lockTx: string;
  resultHash: string | null;
  resultTx: string | null;
  collectTx: string | null;
  refundAuthTx: string | null;
  work: { claimId: string | null; observedStatus: string | null; amountCents: number | null; statusUrl: string | null } | null;
};

async function chainReady(): Promise<{ ready: boolean; reason: string | null }> {
  if (!process.env.BLOCKFROST_PROJECT_ID) return { ready: false, reason: 'Waiting for a Blockfrost preprod key and a funded buyer wallet' };
  return { ready: true, reason: null };
}

const taskSpec = () => ({
  merchant: 'skylane',
  vigil: 'flight_compensation',
  booking_ref: SKYLANE_FLIGHT.bookingRef,
  passenger_name: DEMO_USER.name,
  payout: 'original_card',
});

export async function registerSpecialistRoutes(app: FastifyInstance, { db, bus }: { db: Db; bus: Bus }) {
  app.get('/api/specialist', async () => {
    const [avail, health] = await Promise.all([
      fetch(`${SPECIALIST_URL}/availability`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null) as Promise<any>,
      fetch(`${SPECIALIST_URL}/healthz`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null) as Promise<any>,
    ]);
    let sellerAddress: string | null = null;
    try {
      const { account } = await import('@overpaid/cardano');
      sellerAddress = account('specialist-seller').address;
    } catch {}
    const chain = await chainReady();
    const rows = await db.select().from(hires).orderBy(desc(hires.createdAt)).limit(20);
    return {
      specialist: {
        name: 'Skylane delay-compensation specialist',
        capability: 'Files airline delay compensation claims with the right delay category and evidence',
        fee: `${Number(process.env.SPECIALIST_PRICE_LOVELACE ?? 5_000_000) / 1e6} tADA per claim, paid only through escrow`,
        firstParty: true,
        url: process.env.SPECIALIST_PUBLIC_URL || SPECIALIST_URL,
        registered: !!avail?.agentIdentifier,
        masumiAgentId: avail?.agentIdentifier ?? null,
        online: !!avail,
        sellerAddress,
      },
      chainReady: chain.ready && !!health,
      chainReason: !health ? 'Specialist service is not running' : chain.reason,
      hires: rows.map((h) => ({
        id: h.id,
        longTimer: h.longTimer,
        escrowState: h.escrowState,
        jobId: h.jobId,
        createdAt: h.createdAt,
        payBy: h.payBy,
        submitResultBy: h.submitResultBy,
        unlockAt: h.unlockAt,
        disputeUnlockAt: h.disputeUnlockAt,
        txLock: h.txLock,
        txResult: h.txResult,
        txCollect: h.txCollect,
        txRefund: h.txRefund,
        inputHash: h.inputHash,
        resultHash: h.resultHash,
        note: (h.meta.note as string | undefined) ?? null,
        verified: h.meta.verified === true,
        onchainEscrowState: (h.meta.onchainState as string | undefined) ?? null,
      })),
    };
  });

  app.post('/api/hires', async (req, reply) => {
    const { longTimer, taskId } = z.object({ longTimer: z.boolean().default(false), taskId: z.string().min(1).optional() }).parse(req.body ?? {});
    const chain = await chainReady();
    if (!chain.ready) return reply.code(409).send({ error: chain.reason });
    const { account, hireSpecialist, serial } = await import('@overpaid/cardano');
    const buyer = account('overpaid-buyer');
    const task = taskSpec();

    // Claim the target task atomically (UPDATE ... WHERE state='needs_specialist' RETURNING): two hires can never take
    // the same task, and a task with a hire in an active escrow state is refused.
    const claim = async (id: string) => {
      const conflict = activeHireFor(await db.select({ id: hires.id, taskId: hires.taskId, escrowState: hires.escrowState }).from(hires).where(eq(hires.taskId, id)), id);
      if (conflict) return { conflict };
      const [t] = await db
        .update(tasks)
        .set({ state: 'hired', step: 'Hiring specialist: locking the fee in escrow', startedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.state, 'needs_specialist')))
        .returning();
      return { task: t ?? null };
    };
    let waiting: typeof tasks.$inferSelect | null = null;
    if (taskId) {
      const r = await claim(taskId);
      if (r.conflict) return reply.code(409).send({ error: `task ${taskId} already has an active hire (${r.conflict})` });
      if (!r.task) return reply.code(409).send({ error: `task ${taskId} is not waiting for a specialist` });
      waiting = r.task;
    } else if (!longTimer) {
      // Link to the oldest flight task waiting for a specialist (none for a long-timer started from control).
      const candidates = await db.select().from(tasks).where(and(eq(tasks.recipeId, 'skylane-claim'), eq(tasks.state, 'needs_specialist'))).orderBy(asc(tasks.createdAt));
      for (const c of candidates) {
        const r = await claim(c.id);
        if (r.task) {
          waiting = r.task;
          break;
        }
      }
    }
    if (waiting) await bus.emit('task.updated', { taskId: waiting.id, state: 'hired' });

    const id = newId('hire');
    await db.insert(hires).values({ id, taskId: waiting?.id ?? null, specialistId: 'skylane-specialist', escrowState: 'quoted', longTimer, inputHash: hashCanonical(task) });
    let lockBuilt: { txLock: string; meta: Record<string, unknown> } | null = null;
    try {
      // One hire at a time per buyer wallet (shares the queue with refund txs), so two hires never spend the same UTxO.
      const r = await serial(buyer.address, () =>
        hireSpecialist({
          specialistUrl: SPECIALIST_URL,
          task,
          buyer,
          onLockBuilt: async (l) => {
            const meta = { amountLovelace: l.amountLovelace, sellerAddress: l.sellerAddress, onchainInputHash: l.onchainInputHash, lockBuiltAt: Date.now() };
            await db
              .update(hires)
              .set({
                escrowState: 'settlement_pending', blockchainIdentifier: l.blockchainIdentifier, txLock: l.txLock,
                payBy: new Date(l.payBy), submitResultBy: new Date(l.submitResultTime), unlockAt: new Date(l.unlockTime),
                disputeUnlockAt: new Date(l.externalDisputeUnlockTime), meta,
              })
              .where(eq(hires.id, id));
            lockBuilt = { txLock: l.txLock, meta };
          },
        }),
      );
      const meta = { ...(lockBuilt as { meta: Record<string, unknown> } | null)?.meta, amountLovelace: r.amountLovelace, sellerAddress: r.sellerAddress, onchainInputHash: r.onchainInputHash };
      await db.update(hires).set({ jobId: r.jobId, escrowState: 'FundsLocked', meta }).where(and(eq(hires.id, id), eq(hires.escrowState, 'settlement_pending')));
      if (waiting) {
        // followHires may already have verified the result and closed the task; only touch it while still 'hired'.
        const [still] = await db.update(tasks).set({ step: 'Specialist hired, fee locked in escrow' }).where(and(eq(tasks.id, waiting.id), eq(tasks.state, 'hired'))).returning();
        if (still) await db.update(opportunities).set({ status: 'in_progress' }).where(eq(opportunities.id, waiting.opportunityId));
        await bus.emit('task.updated', { taskId: waiting.id, state: 'hired' });
      }
      await bus.setMetric('escrow_state', 'FundsLocked');
      await bus.emit('escrow.updated', { hireId: id, state: 'FundsLocked', txLock: r.txLock });
      return { id, ...r };
    } catch (e) {
      const err = e as Error & { details?: Record<string, unknown> };
      const built = lockBuilt as { txLock: string; meta: Record<string, unknown> } | null;
      if (built) {
        // The lock tx was signed and handed over; it may still land. followHires watches it (job by lock tx + chain).
        const note = `Paid request did not complete (${err.message}); watching lock tx ${built.txLock} before anything is re-paid.`;
        await db.update(hires).set({ meta: { ...built.meta, note } }).where(eq(hires.id, id));
        await bus.emit('escrow.updated', { hireId: id, state: 'settlement_pending' });
        return reply.code(502).send({ error: err.message, id, escrowState: 'settlement_pending', txLock: built.txLock });
      }
      // Nothing was signed: no money can move. Release the task for a re-hire.
      await db.update(hires).set({ escrowState: 'failed', meta: { note: err.message } }).where(eq(hires.id, id));
      if (waiting) {
        await db.update(tasks).set({ state: 'needs_specialist', step: `Hire failed before payment: ${err.message.slice(0, 120)}` }).where(eq(tasks.id, waiting.id));
        await bus.emit('task.updated', { taskId: waiting.id, state: 'needs_specialist' });
      }
      await bus.emit('escrow.updated', { hireId: id, state: 'failed' });
      return reply.code(502).send({ error: err.message, id });
    }
  });

  // Dispute (refund path b starts here): only from FundsLocked/ResultSubmitted and before unlockTime.
  app.post<{ Params: { id: string } }>('/api/hires/:id/dispute', async (req, reply) => {
    const [h] = await db.select().from(hires).where(eq(hires.id, req.params.id));
    if (!h) return reply.code(404).send({ error: 'no such hire' });
    const blocked = disputeBlocked({ state: h.escrowState, txLock: h.txLock, unlockAt: h.unlockAt }, Date.now());
    if (blocked) return reply.code(409).send({ error: blocked });
    try {
      const r = await openDispute(db, h, 'Disputed by the operator');
      await bus.emit('escrow.updated', { hireId: h.id, state: r.state });
      return r.result;
    } catch (e) {
      return reply.code(409).send({ error: `dispute refused: ${(e as Error).message}` });
    }
  });
}

type HireRow = typeof hires.$inferSelect;

/** SetRefundRequested (buyer). With a result hash on chain this opens a dispute; without one it is a refund request. */
async function openDispute(db: Db, h: HireRow, why: string) {
  const { account, requestRefund } = await import('@overpaid/cardano');
  const result = await requestRefund(account('overpaid-buyer'), { txLock: h.txLock!, blockchainIdentifier: h.blockchainIdentifier ?? undefined }, { awaitConfirmation: false });
  const state = nextHireState(h.escrowState, result.toState ?? (h.resultHash ? 'Disputed' : 'RefundRequested'));
  await db
    .update(hires)
    .set({ escrowState: state, txRefund: result.txHash, meta: { ...h.meta, refundRequestTx: result.txHash, note: `${why}: SetRefundRequested ${result.txHash}` } })
    .where(eq(hires.id, h.id));
  return { result, state };
}

async function readChain(h: HireRow): Promise<ChainView> {
  const { hireEscrowStatus, stateName } = await import('@overpaid/cardano');
  const s = await hireEscrowStatus({ txLock: h.txLock!, blockchainIdentifier: h.blockchainIdentifier ?? undefined });
  if (s.status === 'not_found') return { status: 'not_found' };
  if (s.status === 'open') return { status: 'open', state: s.state, resultHash: s.datum.resultHash };
  return { status: 'closed', closedBy: s.closedBy, lastState: s.last.datum ? stateName(s.last.datum.state) : 'unknown' };
}

const lastChainCheck = new Map<string, number>();

/**
 * Mirrors specialist jobs and the on-chain escrow into hires every few seconds, verifies results independently
 * (Overpaid re-reads the airline's status page and recomputes the evidence hash before it counts the money,
 * docs/BRIEF.md M3 step 5), auto-disputes unverified results before unlock, and withdraws refunds when allowed.
 */
export async function followHires(db: Db, bus: Bus) {
  for (;;) {
    try {
      const active = await db.select().from(hires).where(inArray(hires.escrowState, ACTIVE_HIRE_STATES));
      for (const h of active) {
        try {
          await followOne(db, bus, h);
        } catch {
          // one hire's error never blocks the others
        }
      }
    } catch {
      // database briefly unavailable
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function followOne(db: Db, bus: Bus, h: HireRow) {
  const now = Date.now();
  const meta: Record<string, unknown> = { ...h.meta };
  let state = h.escrowState;
  const patch: Partial<HireRow> = {};

  if (!h.txLock) {
    // Crashed between quote and lock-build: nothing was signed.
    if (h.escrowState === 'quoted' && now - h.createdAt.getTime() > SETTLEMENT_GIVE_UP_MS) state = 'failed';
  } else {
    const raw = await fetch(`${SPECIALIST_URL}/jobs/by-tx/${h.txLock}`, { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const job = raw ? normaliseJob(raw) : null;
    if (job) {
      state = nextHireState(state, ESCROW_FROM_JOB[job.status]);
      patch.jobId = job.id;
      if (job.resultTx) patch.txResult = job.resultTx;
      if (job.collectTx) patch.txCollect = job.collectTx;
      if (job.resultHash) patch.resultHash = job.resultHash;
      if (job.refundAuthTx) meta.refundAuthTx = job.refundAuthTx;
      if (job.status === 'failed') meta.jobError = job.error;
    }

    // On-chain truth (throttled): the escrow state the UI shows, settlement confirmation, refunds.
    if (now - (lastChainCheck.get(h.id) ?? 0) >= CHAIN_CHECK_MS) {
      lastChainCheck.set(h.id, now);
      const { account, withdrawRefund } = await import('@overpaid/cardano');
      const c = await readChain(h).catch(() => null);
      if (c) {
        meta.onchainState = c.status === 'open' ? c.state : c.status === 'closed' ? 'Closed' : 'NotFound';
        meta.onchainCheckedAt = now;
        state = nextHireState(state, stateFromChain(c, { txRefund: h.txRefund, txCollect: patch.txCollect ?? h.txCollect }));
        if (state === 'settlement_pending' && c.status === 'not_found' && !job) {
          const since = h.payBy ? h.payBy.getTime() : ((meta.lockBuiltAt as number | undefined) ?? h.createdAt.getTime());
          if (now > since + SETTLEMENT_GIVE_UP_MS) {
            state = 'failed';
            meta.note = `Lock tx ${h.txLock} never landed before the pay-by deadline; no funds moved.`;
          }
        }
        if (shouldWithdrawRefund(c, h.submitResultBy, now, { submittedAt: meta.refundSubmittedAt as number | undefined })) {
          try {
            const r = await withdrawRefund(account('overpaid-buyer'), { txLock: h.txLock, blockchainIdentifier: h.blockchainIdentifier ?? undefined }, { awaitConfirmation: false });
            patch.txRefund = r.txHash;
            meta.refundSubmittedAt = now;
            meta.note = `WithdrawRefund submitted from ${r.fromState}: ${r.txHash}`;
          } catch (e) {
            meta.refundError = (e as Error).message.slice(0, 300);
          }
        }
      }
    }

    // Independent verification: retried every loop while unverified and before unlock, for every hire.
    const resultHash = patch.resultHash ?? h.resultHash;
    const v = { verified: meta.verified, resultHash, unlockAt: h.unlockAt, state, autoDisputed: meta.autoDisputed };
    if (job && shouldVerify(v, now) && now - ((meta.verifyAttemptAt as number | undefined) ?? 0) >= VERIFY_RETRY_MS) {
      const out = await verifyResult({ ...job, resultHash });
      meta.verified = out.ok;
      meta.verifyAttemptAt = now;
      meta.verifyAttempts = ((meta.verifyAttempts as number | undefined) ?? 0) + 1;
      meta.note = out.note;
      if (out.ok && h.taskId) await recordRecovery(db, bus, h.taskId, out.claimId, out.amount);
    }
    if (shouldAutoDispute({ ...v, verified: meta.verified }, now)) {
      meta.autoDisputed = true;
      try {
        const { result } = await openDispute(db, { ...h, resultHash, meta }, 'Auto-disputed: result still unverified 3 minutes before unlock');
        patch.txRefund = result.txHash;
        meta.refundRequestTx = result.txHash;
        meta.note = `Auto-disputed: result still unverified 3 minutes before unlock (SetRefundRequested ${result.txHash})`;
        state = nextHireState(state, result.toState ?? 'Disputed');
      } catch (e) {
        meta.note = `Auto-dispute failed: ${(e as Error).message.slice(0, 200)}`;
      }
    }
  }

  const changed =
    state !== h.escrowState ||
    Object.entries(patch).some(([k, val]) => (h as Record<string, unknown>)[k] !== val) ||
    JSON.stringify(meta) !== JSON.stringify(h.meta);
  if (!changed) return;
  await db.update(hires).set({ ...patch, escrowState: state, meta }).where(eq(hires.id, h.id));
  if (state === h.escrowState) return;
  await bus.setMetric('escrow_state', state);
  await bus.emit('escrow.updated', { hireId: h.id, state });
  const fx = taskEffect(state);
  if (fx && h.taskId) {
    // Only a task this hire is still driving (never undo a confirmed recovery).
    const [t] = await db
      .update(tasks)
      .set({ state: fx.task, step: fx.step, ...(fx.task === 'failed' ? { finishedAt: new Date() } : {}) })
      .where(and(eq(tasks.id, h.taskId), inArray(tasks.state, ['hired', 'disputed'])))
      .returning();
    if (t) {
      await db.update(opportunities).set({ status: fx.opportunity }).where(eq(opportunities.id, t.opportunityId));
      await bus.emit('task.updated', { taskId: t.id, state: fx.task });
    }
  }
}

// The specialist's public job view (MIP-003 style, snake_case, nested escrow/result) -> our Job shape.
function normaliseJob(j: any): Job {
  return {
    id: j.job_id ?? j.id,
    status: j.detail_status ?? j.status,
    error: j.error ?? null,
    lockTx: j.escrow?.lockTx ?? j.lockTx,
    resultHash: j.result?.result_hash ?? j.resultHash ?? null,
    resultTx: j.escrow?.resultTx ?? j.resultTx ?? null,
    collectTx: j.escrow?.collectTx ?? j.collectTx ?? null,
    refundAuthTx: j.escrow?.refundAuthTx ?? j.refundAuthTx ?? null,
    work: j.work
      ? { claimId: j.work.claim_id ?? j.work.claimId ?? j.result?.claim_id ?? null, observedStatus: j.work.observed ?? null, amountCents: j.work.amountCents ?? null, statusUrl: j.result?.status_url ?? null }
      : null,
  };
}

async function verifyResult(job: Job): Promise<{ ok: boolean; note: string; claimId: string | null; amount: number }> {
  const claimId = job.work?.claimId ?? null;
  let paid = false;
  let amount = 0;
  if (claimId) {
    const s = (await fetch(`${merchantUrl('skylane')}/claims/${claimId}.json`, { headers: { cookie: 'demo_session=alex-demo' }, signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null)) as { status?: string; amountCents?: number; amount_cents?: number } | null;
    paid = s?.status === 'paid';
    amount = s?.amountCents ?? s?.amount_cents ?? job.work?.amountCents ?? 0;
  }
  const manifest = await fetch(`${SPECIALIST_URL}/evidence/${job.id}/manifest.json`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .catch(() => null);
  const hashOk = manifest ? hashCanonical(manifest) === job.resultHash : false;
  const ok = paid && hashOk;
  const note = ok
    ? 'Overpaid re-checked the airline status page and the evidence hash: both match.'
    : `Verification not yet passing (status paid: ${paid}, hash match: ${hashOk}); retrying, auto-dispute 3 minutes before unlock.`;
  return { ok, note, claimId, amount };
}

async function recordRecovery(db: Db, bus: Bus, taskId: string, claimId: string | null, amount: number) {
  const [t] = await db
    .update(tasks)
    .set({ state: 'done', step: `Confirmed ${claimId}`, finishedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.state, 'hired')))
    .returning();
  if (!t) return;
  await db.update(opportunities).set({ status: 'recovered' }).where(eq(opportunities.id, t.opportunityId));
  const ins = await db.insert(recoveries).values({ id: newId('rec'), taskId, amount }).onConflictDoNothing({ target: recoveries.taskId }).returning();
  if (ins.length) await bus.emit('money.recovered', { taskId, amountCents: amount, bySpecialist: true });
  await bus.emit('task.updated', { taskId, state: 'done' });
}
