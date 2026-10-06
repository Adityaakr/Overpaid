import { EventEmitter } from 'node:events';
import { asc, events, gt, metrics, sql, type Db } from '@overpaid/db';
import { makeEvent, type EventType, type MetricKey, type OverpaidEvent } from '@overpaid/shared';

// Every state change is appended to the `events` table and fanned out to live SSE subscribers.
export class Bus {
  private emitter = new EventEmitter();
  constructor(private db: Db) {
    this.emitter.setMaxListeners(200);
  }

  async emit(type: EventType, data: Record<string, unknown>): Promise<OverpaidEvent & { seq: number }> {
    const ev = makeEvent(type, data);
    const [row] = await this.db.insert(events).values({ type, data: ev.data }).returning({ seq: events.seq });
    const out = { ...ev, seq: row!.seq };
    this.emitter.emit('event', out);
    return out;
  }

  subscribe(fn: (e: OverpaidEvent & { seq: number }) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  async since(seq: number, limit = 500) {
    return this.db.select().from(events).where(gt(events.seq, seq)).orderBy(asc(events.seq)).limit(limit);
  }

  async setMetric(key: MetricKey, value: unknown) {
    await this.db
      .insert(metrics)
      .values({ key, value: value as object })
      .onConflictDoUpdate({ target: metrics.key, set: { value: value as object, updatedAt: sql`now()` } });
    await this.emit('metrics.updated', { key, value });
  }

  async allMetrics(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(metrics);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
