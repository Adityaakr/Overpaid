import type { FastifyInstance } from 'fastify';
import { PORTS } from '@overpaid/shared';
import type { Bus } from '../bus.js';

const BLOC_URL = process.env.BLOC_URL ?? `http://127.0.0.1:${PORTS.bloc}`;
const adminHeaders = (): Record<string, string> =>
  process.env.BLOC_ADMIN_TOKEN ? { 'x-admin-token': process.env.BLOC_ADMIN_TOKEN } : {};

const EMPTY = {
  campaign: null,
  joinUrl: null,
  nMax: null,
  pledges: { real: 0, simulated: 0, lockedTotal: 0, recent: [] },
  bids: [],
  settlements: [],
  chainReady: false,
  chainReason: 'Bloc service is not running',
};

async function forward(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${BLOC_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(240_000),
  });
  const text = await r.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json };
}

export async function registerBlocRoutes(app: FastifyInstance, { bus }: { bus: Bus }) {
  app.get('/api/bloc', async () =>
    fetch(`${BLOC_URL}/state`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .catch(() => EMPTY),
  );

  // Public: the phone page. The tunnel exposes only this route of the API (see RUNBOOK).
  app.post('/api/bloc/join', async (req, reply) => {
    const ip = (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip;
    const r = await forward('/join', req.body, { 'x-forwarded-for': ip });
    return reply.code(r.status).send(r.json);
  });

  // Public, non-custodial: the server builds unsigned txs from the user's CIP-30 UTxOs, the browser wallet signs,
  // and the bloc service re-validates before submitting. Bodies pass through unchanged.
  for (const p of ['pledge/build', 'pledge/submit', 'refund/build', 'refund/submit'] as const) {
    app.post(`/api/bloc/${p}`, async (req, reply) => {
      const r = await forward(`/${p}`, req.body);
      return reply.code(r.status).send(r.json);
    });
  }

  app.get('/api/bloc/pledges', async (req, reply) => {
    const address = (req.query as { address?: string }).address ?? '';
    try {
      const r = await fetch(`${BLOC_URL}/pledges?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(5000) });
      return reply.code(r.status).send(await r.json());
    } catch {
      return reply.code(503).send({ error: 'Bloc service is not running' });
    }
  });

  for (const [route, target] of [
    ['/api/bloc/campaign', '/admin/campaign'],
    ['/api/bloc/simulate', '/admin/simulate'],
    ['/api/bloc/settle', '/admin/settle'],
    ['/api/bloc/refund', '/admin/refund'],
    ['/api/bloc/join-tokens', '/admin/join-tokens'],
  ] as const) {
    app.post(route, async (req, reply) => {
      const r = await forward(target, req.body, adminHeaders());
      return reply.code(r.status).send(r.json);
    });
  }
}

/** Mirrors the bloc service's SSE stream onto the product bus, and keeps the metrics bar current. */
export async function followBloc(bus: Bus) {
  for (;;) {
    try {
      const res = await fetch(`${BLOC_URL}/events`, { headers: { accept: 'text/event-stream' } });
      if (!res.ok || !res.body) throw new Error(String(res.status));
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
          if (ev && data && (ev === 'bloc.pledged' || ev === 'bloc.bid' || ev === 'bloc.settled')) {
            await bus.emit(ev, JSON.parse(data));
            await refreshBlocMetrics(bus);
          }
        }
      }
    } catch {
      // bloc service not up yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function refreshBlocMetrics(bus: Bus) {
  type BlocState = {
    campaign: { marketPrice: number } | null;
    pledges: { real: number; simulated: number };
    bids: { unitPrice: number; valid: boolean }[];
    settlements: { txHash: string | null }[];
  };
  const s = (await fetch(`${BLOC_URL}/state`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .catch(() => null)) as BlocState | null;
  if (!s) return;
  await bus.setMetric('pledges_real', s.pledges.real);
  await bus.setMetric('pledges_simulated', s.pledges.simulated);
  await bus.setMetric('settlement_txs', s.settlements.filter((x) => x.txHash).length);
  const best = s.bids.filter((b) => b.valid).sort((a, b) => a.unitPrice - b.unitPrice)[0];
  if (s.campaign && best) await bus.setMetric('price_change_pct', ((best.unitPrice - s.campaign.marketPrice) / s.campaign.marketPrice) * 100);
}
