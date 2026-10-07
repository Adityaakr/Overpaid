import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approvals, desc, eq, evidence, fees, inArray, opportunities, recoveries, sources, sql, tasks, transactions, subscriptions,
} from '@overpaid/db';
import { MERCHANTS } from '@overpaid/shared';
import { FLEET_PUBLIC_URL, type Orchestrator } from '../orchestrator.js';
import { feeView } from './fees.js';
import { runFindAndPersist } from '../find.js';
import type { Ctx } from './core.js';
import { fileURLToPath } from 'node:url';

/** Where the fleet writes evidence bundles (services/fleet/src/config.ts uses the same default). */
const EVIDENCE_ROOT = process.env.EVIDENCE_DIR ?? fileURLToPath(new URL('../../../../evidence', import.meta.url));

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

  // Evidence bundle for a task (read-only): the manifest, and the step screenshots it hashes.
  const evidenceDir = async (taskId: string) => {
    const [e] = await db.select().from(evidence).where(eq(evidence.taskId, taskId));
    if (!e) return null;
    const path = await import('node:path');
    // Older rows were written without the manifest path; the fleet's bundle dir is deterministic.
    return { sha256: e.sha256, dir: e.manifestPath ? path.dirname(e.manifestPath) : path.join(EVIDENCE_ROOT, taskId) };
  };
  app.get<{ Params: { taskId: string } }>('/api/evidence/:taskId', async (req, reply) => {
    if (!/^task_[a-z0-9]+$/.test(req.params.taskId)) return reply.code(404).send({ error: 'no evidence' });
    const ev = await evidenceDir(req.params.taskId);
    if (!ev) return reply.code(404).send({ error: 'no evidence' });
    const { readFile } = await import('node:fs/promises');
    try {
      const manifest = JSON.parse(await readFile(`${ev.dir}/manifest.json`, 'utf8'));
      return { sha256: ev.sha256, manifest };
    } catch {
      return reply.code(404).send({ error: 'manifest missing on disk' });
    }
  });
  app.get<{ Params: { taskId: string; file: string } }>('/api/evidence/:taskId/:file', async (req, reply) => {
    if (!/^task_[a-z0-9]+$/.test(req.params.taskId) || !/^step-\d{3}\.png$/.test(req.params.file)) return reply.code(404).send({ error: 'no such file' });
    const ev = await evidenceDir(req.params.taskId);
    if (!ev) return reply.code(404).send({ error: 'no evidence' });
    const { readFile } = await import('node:fs/promises');
    try {
      const png = await readFile(`${ev.dir}/${req.params.file}`);
      return reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=3600').send(png);
    } catch {
      return reply.code(404).send({ error: 'screenshot missing on disk' });
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
    const feeBy = new Map((await db.select().from(fees)).map((f) => [f.recoveryId, f]));
    return rows.map(({ r, t, o }) => ({
      fee: feeView(feeBy.get(r.id), r.amount, o.merchant),
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

  // The Sunday review: what happened in the last seven days, what waits for a decision, and the next review date.
  app.get('/api/review', async () => {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const recovered = await db
      .select({ r: recoveries, o: opportunities, t: tasks })
      .from(recoveries)
      .innerJoin(tasks, eq(recoveries.taskId, tasks.id))
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .orderBy(desc(recoveries.confirmedAt));
    const week = recovered.filter(({ r }) => r.confirmedAt >= since);
    const pending = await db.select().from(approvals).where(eq(approvals.state, 'pending'));
    const opps = await db.select().from(opportunities).orderBy(desc(opportunities.valueEstimate));
    const taskByOpp = new Map((await db.select().from(tasks)).map((t) => [t.opportunityId, t]));
    const next = new Date();
    next.setUTCDate(next.getUTCDate() + ((7 - next.getUTCDay()) % 7 || 7));
    next.setUTCHours(9, 0, 0, 0);
    const item = (o: typeof opps[number]) => ({
      id: o.id, merchant: o.merchant, vigilType: o.vigilType, valueEstimate: o.valueEstimate, currency: o.currency, status: o.status,
      reason: o.reason, action: (o.meta.action as string | undefined) ?? null, valueBasis: (o.meta.valueBasis as string | undefined) ?? null,
      selfServe: Boolean(o.meta.selfServe), decision: (o.meta.decision as string | undefined) ?? null, task: taskByOpp.get(o.id)?.state ?? null, research: (o.meta.research as Record<string, unknown> | undefined) ?? null,
      new: o.createdAt >= since,
    });
    return {
      since: since.toISOString(),
      nextReviewAt: next.toISOString(),
      recoveredWeekCents: week.reduce((s, { r }) => s + r.amount, 0),
      recoveredTotalCents: recovered.reduce((s, { r }) => s + r.amount, 0),
      recovered: week.map(({ r, o, t }) => ({ id: r.id, merchant: o.merchant, amount: r.amount, currency: r.currency, confirmedAt: r.confirmedAt, mode: t.mode })),
      awaiting: pending.map((a) => ({ id: a.id, taskId: a.taskId, step: a.step, reason: a.reason, createdAt: a.createdAt })),
      decide: opps.filter((o) => (o.status === 'open' || o.status === 'in_progress' || o.status === 'queued') && !(o.meta.decision)).map(item),
      kept: opps.filter((o) => o.meta.decision === 'keep').map(item),
      removed: opps.filter((o) => o.status === 'dismissed').map(item),
      working: opps.filter((o) => o.status === 'queued' || o.status === 'in_progress').map(item),
    };
  });

  // Keep = leave it alone from now on; remove = act on it (or mark it handled) and stop showing it.
  app.post<{ Params: { id: string } }>('/api/opportunities/:id/decide', async (req, reply) => {
    const { decision } = z.object({ decision: z.enum(['keep', 'remove', 'undo']) }).parse(req.body);
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, req.params.id));
    if (!o) return reply.code(404).send({ error: 'no such line' });
    const meta = { ...o.meta };
    if (decision === 'undo') delete meta.decision;
    else meta.decision = decision;
    await db.update(opportunities).set({ meta, status: decision === 'remove' ? 'dismissed' : decision === 'undo' && o.status === 'dismissed' ? 'open' : o.status }).where(eq(opportunities.id, o.id));
    await bus.emit('money.found', { decided: o.id, decision });
    return { ok: true };
  });

  // Plain-language brief for the dashboard and the Sunday review: Claude explains the ledger and drafts the
  // message for one line. The model only writes words; every number comes from the ledger rows.
  const briefCache = new Map<string, { at: number; text: string }>();
  async function claude(system: string, user: string): Promise<string | null> {
    const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY;
    if (!key) return null;
    const res = await fetch(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Clawback app' },
      body: JSON.stringify({ model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5.5', max_tokens: 700, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as any;
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  }

  app.get('/api/ledger/brief', async () => {
    const opps = await db.select().from(opportunities).orderBy(desc(opportunities.valueEstimate));
    const open = opps.filter((o) => o.status === 'open');
    const key = open.map((o) => o.id).join(',');
    const hit = briefCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3_600_000) return { text: hit.text, cached: true };
    if (!open.length) return { text: null };
    const lines = open.slice(0, 12).map((o) => ({ merchant: o.merchant, type: o.vigilType, amount: (o.valueEstimate / 100).toFixed(2), basis: o.meta.valueBasis ?? 'one-off', reason: o.reason }));
    const text = await claude(
      'You write a short plain-language brief for someone reviewing what an agent found on their accounts. Three sentences at most, then at most three bullet points starting with a verb. Use only the numbers given; never invent amounts or merchants. Recurring charges are "to review", never "unused". No headings, no preamble.',
      JSON.stringify(lines),
    );
    if (text) briefCache.set(key, { at: Date.now(), text });
    return { text };
  });

  app.post<{ Params: { id: string } }>('/api/opportunities/:id/draft', async (req, reply) => {
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, req.params.id));
    if (!o) return reply.code(404).send({ error: 'no such line' });
    if (typeof o.meta.draft === 'string') return { draft: o.meta.draft, cached: true };
    const draft = await claude(
      'Write one short message (under 90 words, plain text, no subject line) the account owner can send to this merchant or bank: a cancellation, refund request, fee waiver or request for a better price, matching the finding. Address it to the support team. Use only the facts given; placeholders allowed: [account email], [account number]. No preamble.',
      JSON.stringify({ merchant: o.merchant, finding: o.vigilType, amount: (o.valueEstimate / 100).toFixed(2), basis: o.meta.valueBasis ?? 'one-off', reason: o.reason, action: o.meta.action ?? null }),
    );
    if (!draft) return reply.code(503).send({ error: 'No model configured. Set OPENROUTER_API_KEY to draft messages.' });
    await db.update(opportunities).set({ meta: { ...o.meta, draft } }).where(eq(opportunities.id, o.id));
    return { draft };
  });
}
