import type { FastifyInstance } from 'fastify';
import { sql, type Db } from '@overpaid/db';
import { MERCHANTS, merchantUrl, PORTS, type MerchantKey } from '@overpaid/shared';
import type { Bus } from '../bus.js';

export type Ctx = { db: Db; bus: Bus };

// Tables cleared by a demo reset. Specialists and hires survive so a running long-timer hire is kept.
const RESET_TABLES = [
  'sources', 'transactions', 'subscriptions', 'opportunities', 'tasks', 'approvals', 'evidence',
  'recoveries', 'events', 'metrics', 'idempotency',
];

export async function registerCoreRoutes(app: FastifyInstance, { db, bus }: Ctx) {
  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));

  app.get('/api/metrics', async () => bus.allMetrics());

  // Health of every service, for the demo control panel.
  app.get('/api/health/services', async () => {
    const targets: [string, string][] = [
      ['Fleet', `http://127.0.0.1:${PORTS.fleet}/healthz`],
      ...(Object.keys(MERCHANTS) as MerchantKey[]).map((k) => [MERCHANTS[k].name, `${merchantUrl(k)}/healthz`] as [string, string]),
      ['Specialist', `http://127.0.0.1:${PORTS.specialist}/availability`],
      ['Bloc', `http://127.0.0.1:${PORTS.bloc}/healthz`],
      ['Providers', `http://127.0.0.1:${PORTS.providers}/healthz`],
    ];
    const services = await Promise.all(
      targets.map(async ([name, url]) => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
          const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
          const m = j.model as { model?: string | null } | string | null | undefined;
          const model = typeof m === 'string' ? m : m?.model ?? (j.provider ? 'scripted' : null);
          const detail = [j.provider, model, j.status].filter(Boolean).join(' · ');
          return { name, url, ok: r.ok, detail };
        } catch {
          return { name, url, ok: false, detail: 'not running' };
        }
      }),
    );
    const ready = !!process.env.BLOCKFROST_PROJECT_ID;
    return { services, chain: { ready, reason: ready ? null : 'Waiting for a Blockfrost preprod key and funded wallets' } };
  });

  // Server-sent events. `?since=<seq>` replays the log first so a reconnecting screen never misses a change.
  app.get<{ Querystring: { since?: string } }>('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    const write = (e: { seq: number; type: string; at?: Date | string; data: unknown }) =>
      reply.raw.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...e })}\n\n`);
    const since = Number(req.query.since ?? req.headers['last-event-id'] ?? 0) || 0;
    for (const e of await bus.since(since)) write(e);
    const off = bus.subscribe(write);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
    });
    return reply;
  });

  app.post('/api/demo/reset', async () => {
    const t0 = Date.now();
    await db.execute(sql.raw(`truncate ${RESET_TABLES.join(', ')} restart identity`));
    const merchants = await Promise.all(
      (Object.keys(MERCHANTS) as MerchantKey[]).map(async (k) => {
        try {
          const r = await fetch(`${merchantUrl(k)}/reset`, { method: 'POST', signal: AbortSignal.timeout(5000) });
          return [k, r.ok] as const;
        } catch {
          return [k, false] as const;
        }
      }),
    );
    return { ok: true, ms: Date.now() - t0, merchants: Object.fromEntries(merchants) };
  });
}
