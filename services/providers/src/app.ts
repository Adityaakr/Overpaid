/**
 * services/providers HTTP: GET /healthz, GET /providers (brands, ed25519 bid vkeys for the campaign allowlist,
 * payout addresses), POST /tick (run one bidding round now; localhost only).
 */
import Fastify from 'fastify';
import { BRANDS } from './brands.js';
import type { Bidder } from './bidder.js';

export async function buildApp(d: { bidder: Bidder | null; reason: string | null; blocUrl: string }) {
  const app = Fastify({ logger: false });
  app.get('/healthz', async () => ({ ok: true, service: 'providers', ready: d.bidder !== null, reason: d.reason, blocUrl: d.blocUrl }));
  app.get('/providers', async (_req, reply) => {
    if (!d.bidder) return reply.code(503).send({ error: d.reason, brands: BRANDS.map((b) => ({ key: b.key, name: b.name, strategy: b.strategy })) });
    return {
      simulated: true,
      providers: d.bidder.agents.map((a) => ({
        key: a.brand.key, name: a.brand.name, simulated: true, vkey: a.keys.vkey, address: a.keys.address,
        basePrice: Number(a.brand.basePrice), floor: Number(a.brand.floor), discountBpsPer10: a.brand.discountBpsPer10, maxDiscountBps: a.brand.maxDiscountBps,
        strategy: a.brand.strategy, lastBid: a.last ? Number(a.last.unitPrice) : null, lastResult: a.lastResult,
      })),
    };
  });
  app.post('/tick', async (_req, reply) => {
    if (!d.bidder) return reply.code(503).send({ error: d.reason });
    try {
      return { posted: await d.bidder.tick() };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  return app;
}
