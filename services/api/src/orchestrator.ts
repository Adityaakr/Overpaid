import { and, approvals, eq, evidence, inArray, opportunities, recoveries, sql, tasks, type Db } from '@overpaid/db';
import { newId, PORTS } from '@overpaid/shared';
import type { Bus } from './bus.js';

export const FLEET_URL = process.env.FLEET_URL ?? `http://127.0.0.1:${PORTS.fleet}`;
// The browser reaches the fleet's frame stream directly (both are localhost on the demo laptop).
export const FLEET_PUBLIC_URL = process.env.FLEET_PUBLIC_URL ?? `http://localhost:${PORTS.fleet}`;

// Ledger line -> fleet recipe. Flight compensation goes to the specialist instead.
export function recipeFor(vigilType: string, meta: Record<string, unknown>): { recipeId: string; params: Record<string, unknown> } | null {
  const orderId = (meta.orderId ?? meta.order_id) as string | undefined;
  switch (vigilType) {
    case 'forgotten_subscription':
      return { recipeId: 'vistaflix-cancel', params: { planId: meta.planId ?? meta.plan_id } };
    case 'duplicate_charge':
      return { recipeId: 'cartwell-duplicate', params: { orderId } };
    case 'price_drop':
      return { recipeId: 'cartwell-price-adjust', params: { orderId } };
    case 'undelivered_order':
      return { recipeId: 'parcelo-undelivered', params: { orderId } };
    default:
      return null;
  }
}

type FleetEvent = {
  type: string;
  data: {
    taskId: string;
    state?: string;
    step?: string | null;
    mode?: string;
    amountCents?: number;
    confirmationCode?: string;
    evidenceSha256?: string;
    manifestPath?: string;
    failureReason?: string;
    approvalId?: string;
    reason?: string;
    screenshotUrl?: string;
    text?: string;
    costCents?: number;
    recovered?: boolean;
    verifiedStatus?: string;
  };
};

export class Orchestrator {
  private fleetOnline = false;
  constructor(private db: Db, private bus: Bus) {}

  get online() {
    return this.fleetOnline;
  }

  async fixOpportunities(ids: string[] | 'all') {
    const rows = await this.db
      .select()
      .from(opportunities)
      .where(ids === 'all' ? eq(opportunities.status, 'open') : and(inArray(opportunities.id, ids), eq(opportunities.status, 'open')));
    const created: string[] = [];
    for (const o of rows) {
      if (o.vigilType === 'bill_above_market') continue;
      const id = newId('task');
      if (o.vigilType === 'flight_compensation') {
        await this.db.insert(tasks).values({ id, opportunityId: o.id, recipeId: 'skylane-claim', state: 'needs_specialist', mode: 'agent', step: 'Needs an airline-compensation specialist' });
        await this.db.update(opportunities).set({ status: 'queued' }).where(eq(opportunities.id, o.id));
        await this.bus.emit('task.updated', { taskId: id, state: 'needs_specialist' });
        created.push(id);
        continue;
      }
      const r = recipeFor(o.vigilType, o.meta);
      if (!r) continue;
      await this.db.insert(tasks).values({ id, opportunityId: o.id, recipeId: r.recipeId, state: 'queued', mode: 'agent', step: 'Queued' });
      await this.db.update(opportunities).set({ status: 'queued' }).where(eq(opportunities.id, o.id));
      await this.bus.emit('task.updated', { taskId: id, state: 'queued' });
      created.push(id);
      try {
        const res = await fetch(`${FLEET_URL}/tasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: id, recipeId: r.recipeId, params: r.params, mode: 'auto' }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`fleet ${res.status}`);
      } catch (e) {
        await this.fail(id, `Fleet unavailable: ${(e as Error).message}`);
      }
    }
    return created;
  }

  async decideApproval(approvalId: string, approved: boolean) {
    const [a] = await this.db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!a) throw new Error('approval not found');
    if (a.state !== 'pending') return a;
    await this.db.update(approvals).set({ state: approved ? 'approved' : 'rejected', decidedAt: new Date() }).where(eq(approvals.id, approvalId));
    const res = await fetch(`${FLEET_URL}/tasks/${a.taskId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved, approvalId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`fleet ${res.status}`);
    await this.bus.emit('task.updated', { taskId: a.taskId, approval: approved ? 'approved' : 'rejected' });
    return { ...a, state: approved ? 'approved' : 'rejected' };
  }

  private async fail(taskId: string, reason: string) {
    await this.db.update(tasks).set({ state: 'failed', failureReason: reason, finishedAt: new Date() }).where(eq(tasks.id, taskId));
    const [t] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (t) await this.db.update(opportunities).set({ status: 'failed' }).where(eq(opportunities.id, t.opportunityId));
    await this.bus.emit('task.updated', { taskId, state: 'failed', failureReason: reason });
  }

  /** Mirrors the fleet's event stream into the database and the product event bus. Reconnects forever. */
  async follow() {
    for (;;) {
      try {
        const res = await fetch(`${FLEET_URL}/events`, { headers: { accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error(`fleet events ${res.status}`);
        this.fleetOnline = true;
        console.log('following fleet events');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = chunk.match(/^event: (.+)$/m)?.[1];
            const data = chunk.match(/^data: (.+)$/m)?.[1];
            if (ev && data) await this.onFleetEvent({ type: ev, data: JSON.parse(data) }).catch((err) => console.error('fleet event failed', ev, err));
          }
        }
      } catch (err) {
        if (this.fleetOnline) console.error('fleet stream ended', err);
      }
      this.fleetOnline = false;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private async onFleetEvent(e: FleetEvent) {
    const d = e.data;
    if (!d?.taskId) return;
    const [t] = await this.db.select().from(tasks).where(eq(tasks.id, d.taskId));
    if (!t) return;
    if (e.type === 'approval.requested') {
      const id = d.approvalId ?? newId('appr');
      await this.db
        .insert(approvals)
        .values({ id, taskId: t.id, step: d.step ?? 'Irreversible step', reason: d.reason ?? '', screenshot: d.screenshotUrl ?? null })
        .onConflictDoNothing();
      await this.db.update(tasks).set({ state: 'needs_approval', step: d.step ?? t.step }).where(eq(tasks.id, t.id));
      await this.bus.emit('approval.requested', { taskId: t.id, approvalId: id });
      return;
    }
    if (e.type === 'task.flagged') {
      await this.db.update(tasks).set({ step: `Flagged: ${d.text ?? ''}`.slice(0, 300) }).where(eq(tasks.id, t.id));
      await this.bus.emit('task.updated', { taskId: t.id, flagged: d.text ?? '' });
      return;
    }
    if (e.type !== 'task.updated') return;
    const set: Partial<typeof tasks.$inferInsert> = {};
    if (d.state) set.state = d.state;
    if (d.step !== undefined) set.step = d.step;
    if (d.mode) set.mode = d.mode;
    if (d.costCents != null) set.costCents = d.costCents;
    if (d.state === 'running' && !t.startedAt) set.startedAt = new Date();
    if (d.state === 'done' || d.state === 'failed') set.finishedAt = new Date();
    if (d.failureReason) set.failureReason = d.failureReason;
    await this.db.update(tasks).set(set).where(eq(tasks.id, t.id));

    if (d.state === 'running') await this.db.update(opportunities).set({ status: 'in_progress' }).where(eq(opportunities.id, t.opportunityId));
    if (d.state === 'failed') await this.db.update(opportunities).set({ status: 'failed' }).where(eq(opportunities.id, t.opportunityId));
    if (d.state === 'done') {
      await this.db.update(opportunities).set({ status: 'recovered' }).where(eq(opportunities.id, t.opportunityId));
      if (d.evidenceSha256) {
        await this.db.insert(evidence).values({ id: newId('ev'), taskId: t.id, manifestPath: d.manifestPath ?? '', sha256: d.evidenceSha256 }).onConflictDoNothing();
      }
      // Count money only when the merchant's own status page shows it came back (fleet sets recovered:true).
      if (d.amountCents != null && d.recovered) {
        const inserted = await this.db
          .insert(recoveries)
          .values({ id: newId('rec'), taskId: t.id, amount: d.amountCents })
          .onConflictDoNothing({ target: recoveries.taskId })
          .returning({ id: recoveries.id });
        if (inserted.length) await this.bus.emit('money.recovered', { taskId: t.id, amountCents: d.amountCents, confirmationCode: d.confirmationCode ?? null });
      }
      await this.db
        .update(tasks)
        .set({ step: d.confirmationCode ? `Confirmed ${d.confirmationCode}` : `Accepted${d.verifiedStatus ? ` (${d.verifiedStatus})` : ''}` })
        .where(eq(tasks.id, t.id));
    }
    await this.bus.emit('task.updated', { taskId: t.id, state: d.state ?? t.state });
    await this.refreshMetrics();
  }

  async refreshMetrics() {
    const [r] = await this.db.execute<{ recovered: string | null; n: string; cost: string | null; live: string }>(sql`
      select (select coalesce(sum(amount),0) from recoveries) as recovered,
             (select count(*) from recoveries) as n,
             (select coalesce(sum(cost_cents),0) from tasks) as cost,
             (select count(*) from tasks where state in ('running','needs_approval')) as live`);
    const recovered = Number(r?.recovered ?? 0);
    const n = Number(r?.n ?? 0);
    await this.bus.setMetric('recovered_cents', recovered);
    await this.bus.setMetric('browsers_live', Number(r?.live ?? 0));
    await this.bus.setMetric('cost_per_recovery_cents', n ? Math.round(Number(r?.cost ?? 0) / n) : 0);
  }
}
