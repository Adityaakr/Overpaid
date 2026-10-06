import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approvals, desc, eq, evidence, inArray, opportunities, recoveries, sources, sql, tasks, transactions, subscriptions,
} from '@overpaid/db';
import { MERCHANTS } from '@overpaid/shared';
import { FLEET_PUBLIC_URL, type Orchestrator } from '../orchestrator.js';
import { runFindAndPersist } from '../find.js';
import type { Ctx } from './core.js';

export async function registerProductRoutes(app: FastifyInstance, { db, bus }: Ctx, orch: Orchestrator) {
  // ---------- Find ----------
  const FindBody = z.object({
    mode: z.enum(['demo', 'upload']),
    files: z.array(z.object({ name: z.string(), base64: z.string() })).optional(),
  });
  app.post('/api/find/run', { bodyLimit: 60 * 1024 * 1024 }, async (req, reply) => {
    const body = FindBody.parse(req.body);
    if (body.mode === 'upload' && !body.files?.length) return reply.code(400).send({ error: 'no files' });
    return runFindAndPersist({ db, bus }, body);
  });

  app.get('/api/ledger', async () => {
    const opps = await db.select().from(opportunities).orderBy(desc(opportunities.valueEstimate));
    const srcIds = [...new Set(opps.flatMap((o) => o.sourceRecordIds))];
    const txs = srcIds.length ? await db.select().from(transactions).where(inArray(transactions.id, srcIds)) : [];
    const srcRows = srcIds.length ? await db.select().from(sources).where(inArray(sources.id, srcIds)) : [];
    const label = new Map<string, string>();
    for (const t of txs) label.set(t.id, `${t.date} · ${t.descriptor} · ${(t.amount / 100).toFixed(2)} ${t.currency}`);
    for (const s of srcRows) label.set(s.id, `${s.kind === 'email' ? 'Email' : 'Statement'} · ${s.filename}`);
    const [counts] = await db.execute<{ emails: string; statements: string; txs: string; demo: boolean | null }>(sql`
      select (select count(*) from sources where kind='email') as emails,
             (select count(*) from sources where kind='statement') as statements,
             (select count(*) from transactions) as txs,
             (select bool_and(demo) from sources) as demo`);
    const run = (await bus.allMetrics()).find_run as { ranAt?: string; durationMs?: number } | undefined;
    return {
      total: opps.reduce((s, o) => s + o.valueEstimate, 0),
      currency: 'USD',
      count: opps.length,
      ranAt: run?.ranAt ?? null,
      durationMs: run?.durationMs ?? null,
      demo: counts?.demo ?? true,
      sourceCounts: { emails: Number(((await bus.allMetrics()).emails_read as number | undefined) ?? counts?.emails ?? 0), statements: Number(counts?.statements ?? 0), transactions: Number(counts?.txs ?? 0) },
      items: opps.map((o) => ({
        id: o.id,
        vigilType: o.vigilType,
        merchant: o.merchant,
        valueEstimate: o.valueEstimate,
        currency: o.currency,
        confidence: o.confidence,
        reason: o.reason,
        status: o.status,
        meta: o.meta,
        sources: o.sourceRecordIds.map((id) => ({ id, label: (o.meta.sourceLabels as Record<string, string> | undefined)?.[id] ?? label.get(id) ?? id })),
      })),
    };
  });

  app.get('/api/subscriptions', async () => db.select().from(subscriptions));

  // ---------- Fix ----------
  const FixBody = z.object({ opportunityIds: z.union([z.literal('all'), z.array(z.string())]) });
  app.post('/api/fix', async (req) => {
    const { opportunityIds } = FixBody.parse(req.body);
    const created = await orch.fixOpportunities(opportunityIds);
    return { tasks: created };
  });

  app.get('/api/tasks', async () => {
    const rows = await db
      .select({ t: tasks, o: opportunities })
      .from(tasks)
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .orderBy(tasks.createdAt);
    const recs = await db.select().from(recoveries);
    const evs = await db.select().from(evidence);
    const recBy = new Map(recs.map((r) => [r.taskId, r.amount]));
    const evBy = new Map(evs.map((e) => [e.taskId, e.sha256]));
    const health = (await fetch(`${process.env.FLEET_URL ?? 'http://127.0.0.1:4500'}/healthz`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json())
      .catch(() => null)) as { provider?: string; model?: { model?: string | null } | null } | null;
    return {
      provider: health?.provider ?? 'local',
      model: health?.model?.model ?? null,
      fleetOnline: orch.online,
      recoveredCents: recs.reduce((s, r) => s + r.amount, 0),
      tasks: rows.map(({ t, o }) => ({
        id: t.id,
        state: t.state,
        step: t.step,
        mode: t.mode,
        merchant: o.merchant,
        vigilType: o.vigilType,
        valueEstimate: o.valueEstimate,
        recoveredCents: recBy.get(t.id) ?? null,
        confirmationCode: t.step?.startsWith('Confirmed ') ? t.step.slice(10) : null,
        evidenceSha256: evBy.get(t.id) ?? null,
        failureReason: t.failureReason,
        streamUrl: t.recipeId === 'skylane-claim' ? null : `${FLEET_PUBLIC_URL}/tasks/${t.id}/stream`,
        frameUrl: t.recipeId === 'skylane-claim' ? null : `${FLEET_PUBLIC_URL}/tasks/${t.id}/frame.jpg`,
        flagged: t.step?.startsWith('Flagged: ') ? t.step.slice(9) : null,
        bySpecialist: t.recipeId === 'skylane-claim',
      })),
    };
  });

  app.get<{ Querystring: { state?: string } }>('/api/approvals', async (req) => {
    const rows = await db
      .select({ a: approvals, o: opportunities })
      .from(approvals)
      .innerJoin(tasks, eq(approvals.taskId, tasks.id))
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .where(req.query.state ? eq(approvals.state, req.query.state) : sql`true`)
      .orderBy(approvals.createdAt);
    return rows.map(({ a, o }) => ({
      id: a.id,
      taskId: a.taskId,
      merchant: o.merchant,
      step: a.step,
      reason: a.reason,
      state: a.state,
      screenshotUrl: a.screenshot ? (a.screenshot.startsWith('http') ? a.screenshot : `${FLEET_PUBLIC_URL}${a.screenshot}`) : null,
    }));
  });

  app.post<{ Params: { id: string } }>('/api/approvals/:id', async (req) => {
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
    return orch.decideApproval(req.params.id, approved);
  });

  // Evidence bundle manifest for a task (read-only).
  app.get<{ Params: { taskId: string } }>('/api/evidence/:taskId', async (req, reply) => {
    const [e] = await db.select().from(evidence).where(eq(evidence.taskId, req.params.taskId));
    if (!e?.manifestPath) return reply.code(404).send({ error: 'no evidence' });
    const { readFile } = await import('node:fs/promises');
    try {
      const manifest = JSON.parse(await readFile(e.manifestPath, 'utf8'));
      return { sha256: e.sha256, manifest };
    } catch {
      return reply.code(404).send({ error: 'manifest missing on disk' });
    }
  });

  // ---------- Receipts ----------
  app.get('/api/receipts', async () => {
    const rows = await db
      .select({ r: recoveries, t: tasks, o: opportunities })
      .from(recoveries)
      .innerJoin(tasks, eq(recoveries.taskId, tasks.id))
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .orderBy(desc(recoveries.confirmedAt));
    const evs = await db.select().from(evidence);
    const evBy = new Map(evs.map((e) => [e.taskId, e]));
    return rows.map(({ r, t, o }) => ({
      id: r.id,
      merchant: o.merchant,
      vigilType: o.vigilType,
      amount: r.amount,
      currency: r.currency,
      confirmedAt: r.confirmedAt,
      confirmation: t.step?.startsWith('Confirmed ') ? t.step.slice(10) : null,
      mode: t.mode,
      evidenceSha256: evBy.get(t.id)?.sha256 ?? null,
      evidenceUrl: evBy.get(t.id) ? `/api/evidence/${t.id}` : null,
      demoMerchant: Object.values(MERCHANTS).some((m) => m.name === o.merchant),
    }));
  });
}
