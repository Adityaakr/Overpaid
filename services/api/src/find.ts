import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { opportunities, sources, subscriptions, sql, transactions, type Db } from '@overpaid/db';
import { DEMO_TODAY, newId } from '@overpaid/shared';
import type { Bus } from './bus.js';

export const DEMO_DIR = fileURLToPath(new URL('../../../data/demo', import.meta.url));

type FindInput = { mode: 'demo' | 'upload'; files?: { name: string; base64: string }[] };

/**
 * Runs the Find pipeline (packages/find) and replaces the ledger. Uploaded exports are parsed in memory and
 * never written to disk; only the derived ledger is stored.
 */
export async function runFindAndPersist({ db, bus }: { db: Db; bus: Bus }, input: FindInput) {
  const find = await import('@overpaid/find');
  const t0 = performance.now();
  const result =
    input.mode === 'demo'
      ? await find.runFind({ dir: DEMO_DIR }, { today: DEMO_TODAY })
      : await find.runFind({ files: input.files!.map((f) => ({ name: f.name, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')) })) });

  // Human-readable labels for every record an opportunity cites (emails are not stored, only their labels).
  const labels = new Map<string, string>();
  for (const e of result.emails) labels.set(e.id, `Email ${e.date} · ${e.subject}`);
  for (const t of result.transactions) labels.set(t.id, `Statement ${t.date} · ${t.descriptor} · ${(t.amount / 100).toFixed(2)} ${t.currency}`);
  const kindOf = (k: string) => (k === 'eml' || k === 'mbox' ? 'email' : k.startsWith('statement') ? 'statement' : k);
  const durationMs = Math.round(performance.now() - t0);

  // Opportunity ids are deterministic, so a re-run keeps the status of lines that already have tasks.
  const prior = new Map((await db.select({ id: opportunities.id, status: opportunities.status }).from(opportunities)).map((o) => [o.id, o.status]));
  await db.execute(sql`truncate sources, transactions, subscriptions, opportunities`);
  const demo = input.mode === 'demo';
  if (result.sources.length)
    await db.insert(sources).values(result.sources.filter((s) => s.kind !== 'ignored').map((s) => ({ id: s.id, kind: kindOf(s.kind), filename: s.name, demo })));
  for (let i = 0; i < result.transactions.length; i += 500) {
    await db.insert(transactions).values(
      result.transactions.slice(i, i + 500).map((t) => ({
        id: t.id, sourceId: t.sourceId, merchant: t.merchant, descriptor: t.descriptor, amount: t.amount,
        currency: t.currency, date: t.date, orderId: t.orderId ?? null,
      })),
    );
  }
  if (result.subscriptions.length)
    await db.insert(subscriptions).values(
      result.subscriptions.map((s) => ({
        id: s.id ?? newId('sub'), merchant: s.merchant, plan: s.planName ?? s.merchant, amount: s.amount, currency: s.currency ?? 'USD',
        cadence: s.cadence, nextRenewal: s.nextCharge ?? null, lastUseSignal: s.lastUseSignal ?? null,
      })),
    );
  // Real uploads also get the statement audit: recurring charges to review, bills to renegotiate, price rises,
  // duplicates and fees. These are self-serve lines with a concrete action; no demo browser recipe runs on them.
  const extra: typeof result.opportunities = [];
  if (!demo) {
    const { auditFind } = await import('@overpaid/coworker/audit');
    const VIGIL_OF = { duplicate: 'duplicate_charge', fee: 'bank_fee', price_increase: 'price_increase', cancel_or_keep: 'recurring_review', negotiate: 'bill_review' } as const;
    const a = auditFind(result);
    for (const it of a.items) {
      if (it.kind === 'recover') continue;
      const ids = it.rows.map((r) => r.id);
      extra.push({
        id: `opp_${createHash('sha256').update(`${it.kind}|${it.title}|${ids.join(',')}`).digest('hex').slice(0, 12)}`,
        vigilType: VIGIL_OF[it.kind] as never, merchant: it.title, valueEstimate: it.cents, currency: a.currency,
        confidence: it.confidence === 'high' ? 0.9 : it.confidence === 'medium' ? 0.7 : 0.5, reason: it.why, sourceRecordIds: ids, status: 'open',
        meta: { action: it.action, category: it.category, valueBasis: it.per === 'year' ? 'annual' : 'one-off', selfServe: true },
      });
    }
  }
  const all = [...result.opportunities.map((o) => (demo ? o : { ...o, meta: { ...(o.meta ?? {}), selfServe: true } })), ...extra];
  if (all.length)
    await db.insert(opportunities).values(
      all.map((o) => ({
        id: o.id, vigilType: o.vigilType, merchant: o.merchant, valueEstimate: o.valueEstimate, currency: o.currency,
        confidence: o.confidence, reason: o.reason, sourceRecordIds: o.sourceRecordIds, status: prior.get(o.id) ?? 'open',
        meta: { ...(o.meta ?? {}), sourceLabels: Object.fromEntries(o.sourceRecordIds.map((id) => [id, labels.get(id) ?? id])) },
      })),
    );

  const total = all.reduce((s, o) => s + o.valueEstimate, 0);
  await bus.setMetric('found_cents', total);
  await bus.setMetric('find_run', { ranAt: new Date().toISOString(), durationMs, demo });
  await bus.setMetric('emails_read', result.emails.length);
  await bus.emit('money.found', { totalCents: total, count: all.length, durationMs, demo });
  return { totalCents: total, count: all.length, durationMs, timings: result.timings ?? null };
}
