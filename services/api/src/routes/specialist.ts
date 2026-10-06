import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, hires, inArray, opportunities, recoveries, tasks, type Db } from '@overpaid/db';
import { DEMO_USER, PORTS, SKYLANE_FLIGHT, hashCanonical, merchantUrl, newId } from '@overpaid/shared';
import type { Bus } from '../bus.js';

const SPECIALIST_URL = process.env.SPECIALIST_URL ?? `http://127.0.0.1:${PORTS.specialist}`;
const ACTIVE_HIRE_STATES = ['quoted', 'FundsLocked', 'ResultSubmitted', 'RefundRequested', 'Disputed', 'RefundAuthorized', 'WithdrawAuthorized'];

// Specialist job status -> escrow state shown in the UI (vested_pay v2 states, plus closed outcomes).
const ESCROW_FROM_JOB: Record<string, string> = {
  awaiting_payment: 'FundsLocked',
  locked: 'FundsLocked',
  running: 'FundsLocked',
  evidence_ready: 'FundsLocked',
  result_submitted: 'ResultSubmitted',
  disputed: 'Disputed',
  refund_authorized: 'RefundAuthorized',
  collected: 'Withdrawn',
  refunded: 'RefundWithdrawn',
  failed: 'failed',
};

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
      })),
    };
  });

  app.post('/api/hires', async (req, reply) => {
    const { longTimer } = z.object({ longTimer: z.boolean().default(false) }).parse(req.body ?? {});
    const chain = await chainReady();
    if (!chain.ready) return reply.code(409).send({ error: chain.reason });
    const { account, hireSpecialist } = await import('@overpaid/cardano');
    const task = taskSpec();
    // Link the hire to the flight task that is waiting for a specialist (none for a long-timer started from control).
    const [waiting] = longTimer
      ? []
      : await db.select().from(tasks).where(and(eq(tasks.recipeId, 'skylane-claim'), eq(tasks.state, 'needs_specialist')));
    const id = newId('hire');
    await db.insert(hires).values({ id, taskId: waiting?.id ?? null, specialistId: 'skylane-specialist', escrowState: 'quoted', longTimer, inputHash: hashCanonical(task) });
    try {
      const r = await hireSpecialist({ specialistUrl: SPECIALIST_URL, task, buyer: account('overpaid-buyer') });
      await db
        .update(hires)
        .set({
          jobId: r.jobId,
          blockchainIdentifier: r.blockchainIdentifier,
          escrowState: 'FundsLocked',
          payBy: new Date(r.payBy),
          submitResultBy: new Date(r.submitResultTime),
          unlockAt: new Date(r.unlockTime),
          disputeUnlockAt: new Date(r.externalDisputeUnlockTime),
          txLock: r.txLock,
          meta: { amountLovelace: r.amountLovelace, sellerAddress: r.sellerAddress, onchainInputHash: r.onchainInputHash },
        })
        .where(eq(hires.id, id));
      if (waiting) {
        await db.update(tasks).set({ state: 'hired', step: 'Specialist hired, fee locked in escrow', startedAt: new Date() }).where(eq(tasks.id, waiting.id));
        await db.update(opportunities).set({ status: 'in_progress' }).where(eq(opportunities.id, waiting.opportunityId));
        await bus.emit('task.updated', { taskId: waiting.id, state: 'hired' });
      }
      await bus.setMetric('escrow_state', 'FundsLocked');
      await bus.emit('escrow.updated', { hireId: id, state: 'FundsLocked', txLock: r.txLock });
      return { id, ...r };
    } catch (e) {
      const err = e as Error & { details?: Record<string, unknown> };
      await db.update(hires).set({ escrowState: 'failed', meta: { note: err.message, ...(err.details ?? {}) } }).where(eq(hires.id, id));
      await bus.emit('escrow.updated', { hireId: id, state: 'failed' });
      return reply.code(502).send({ error: err.message });
    }
  });

  // Dispute (refund path b starts here): only before unlockTime, and only when our own check fails.
  app.post<{ Params: { id: string } }>('/api/hires/:id/dispute', async (req, reply) => {
    const [h] = await db.select().from(hires).where(eq(hires.id, req.params.id));
    if (!h?.txLock) return reply.code(404).send({ error: 'no such hire' });
    const { account, requestRefund } = await import('@overpaid/cardano');
    const r = await requestRefund(account('overpaid-buyer'), { txLock: h.txLock, blockchainIdentifier: h.blockchainIdentifier ?? undefined });
    await db.update(hires).set({ escrowState: h.resultHash ? 'Disputed' : 'RefundRequested', txRefund: (r as { txHash?: string }).txHash ?? null }).where(eq(hires.id, h.id));
    await bus.emit('escrow.updated', { hireId: h.id, state: 'dispute' });
    return r;
  });
}

/**
 * Mirrors specialist jobs into hires every few seconds, and verifies results independently: Overpaid re-reads
 * the airline's status page and recomputes the evidence hash before it counts the money (docs/BRIEF.md M3 step 5).
 */
export async function followHires(db: Db, bus: Bus) {
  for (;;) {
    try {
      const active = await db.select().from(hires).where(inArray(hires.escrowState, ACTIVE_HIRE_STATES));
      for (const h of active) {
        if (!h.txLock) continue;
        const job = (await fetch(`${SPECIALIST_URL}/jobs/by-tx/${h.txLock}`, { signal: AbortSignal.timeout(3000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)) as Job | null;
        if (!job) continue;
        const escrowState = ESCROW_FROM_JOB[job.status] ?? h.escrowState;
        const changed =
          escrowState !== h.escrowState || job.resultTx !== h.txResult || job.collectTx !== h.txCollect || job.resultHash !== h.resultHash;
        if (!changed) continue;
        await db
          .update(hires)
          .set({ escrowState, jobId: job.id, txResult: job.resultTx, txCollect: job.collectTx, resultHash: job.resultHash, txRefund: job.refundAuthTx ?? h.txRefund })
          .where(eq(hires.id, h.id));
        await bus.setMetric('escrow_state', escrowState);
        await bus.emit('escrow.updated', { hireId: h.id, state: escrowState });

        if (job.resultHash && !h.resultHash && h.taskId) await verifyAndRecord(db, bus, h.id, h.taskId, job);
      }
    } catch {
      // specialist or database briefly unavailable
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function verifyAndRecord(db: Db, bus: Bus, hireId: string, taskId: string, job: Job) {
  const claimId = job.work?.claimId;
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
  const note = paid && hashOk ? 'Overpaid re-checked the airline status page and the evidence hash: both match.' : `Verification failed (status paid: ${paid}, hash match: ${hashOk}). Dispute before unlock.`;
  await db.update(hires).set({ meta: { note, verified: paid && hashOk } }).where(eq(hires.id, hireId));
  if (paid && hashOk) {
    await db.update(tasks).set({ state: 'done', step: `Confirmed ${claimId}`, finishedAt: new Date() }).where(eq(tasks.id, taskId));
    const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (t) await db.update(opportunities).set({ status: 'recovered' }).where(eq(opportunities.id, t.opportunityId));
    const ins = await db.insert(recoveries).values({ id: newId('rec'), taskId, amount }).onConflictDoNothing({ target: recoveries.taskId }).returning();
    if (ins.length) await bus.emit('money.recovered', { taskId, amountCents: amount, bySpecialist: true });
    await bus.emit('task.updated', { taskId, state: 'done' });
  }
}
