import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Routes that spend Overpaid's own funds or wipe state need the operator token.
const OPERATOR_ROUTES = [
  /^\/api\/demo\/reset$/,
  /^\/api\/hires(\/[^/]+\/dispute)?$/,
  /^\/api\/bloc\/(campaign|simulate|settle|refund|join-tokens)$/,
];

export function webOrigins(): string[] {
  const extra = (process.env.WEB_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const pub = process.env.PUBLIC_BASE_URL ? [new URL(process.env.PUBLIC_BASE_URL).origin] : [];
  return [...new Set(['http://localhost:3000', 'http://127.0.0.1:3000', ...extra, ...pub])];
}

// What a visitor on the public URL may do: pledge, refund, join and pay fees with their own wallet.
const PUBLIC_WRITES = [
  /^\/api\/bloc\/(join|pledge\/build|pledge\/submit|refund\/build|refund\/submit)$/,
  /^\/api\/fees\/[^/]+\/(build|submit)$/,
  /^\/api\/anchor\/(build|submit)$/,
  /^\/api\/audit\/(preview|messages)$/,
  /^\/api\/x402\/(audit|pay\/build|pay\/assemble)$/,
  /^\/api\/opportunities\/[^/]+\/(decide|draft)$/,
];
// Open to any client, including other agents: payment is the gate.
const OPEN_ROUTES = [/^\/api\/x402\/audit$/];
// What a visitor may start that costs us something (a parse, a browser agent, a demo step): allowed, but
// capped per address per hour so a public link cannot drain the model or browser budget.
const VISITOR_WRITES: [RegExp, number][] = [
  [/^\/api\/find\/run$/, 8],
  [/^\/api\/fix$/, 6],
  [/^\/api\/approvals\/[^/]+$/, 20],
];
const visits = new Map<string, number[]>();
function overLimit(who: string, key: string, limit: number): boolean {
  const now = Date.now();
  const k = `${who} ${key}`;
  const recent = (visits.get(k) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) return true;
  visits.set(k, [...recent, now]);
  if (visits.size > 5000) for (const [kk, v] of visits) if (!v.some((t) => now - t < 3_600_000)) visits.delete(kk);
  return false;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function registerGuard(app: FastifyInstance) {
  const token = process.env.OPERATOR_TOKEN ?? '';
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;
    const path = req.url.split('?')[0]!;
    // Every write must come from our web app or a local script: a custom header forces a CORS preflight,
    // which foreign origins fail, so other websites can't drive this API from the user's browser.
    if (OPEN_ROUTES.some((r) => r.test(path))) return;
    if (req.headers['x-overpaid-client'] === undefined) return reply.code(403).send({ error: 'missing x-overpaid-client header' });
    // Requests through the public tunnel carry cf-connecting-ip; everything except the public writes is the operator's.
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    const remote = req.headers['cf-connecting-ip'] !== undefined || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const visitor = VISITOR_WRITES.find(([r]) => r.test(path));
    if (remote && visitor && !OPERATOR_ROUTES.some((r) => r.test(path))) {
      const who = String(req.headers['cf-connecting-ip'] ?? req.ip);
      if (overLimit(who, visitor[0].source, visitor[1])) return reply.code(429).send({ error: 'That is enough for one hour from this address. Try again later.' });
      return;
    }
    if (OPERATOR_ROUTES.some((r) => r.test(path)) || (remote && !PUBLIC_WRITES.some((r) => r.test(path)))) {
      const got = String(req.headers['x-operator-token'] ?? '');
      if (!token || !same(got, token)) return reply.code(401).send({ error: 'operator token required for this action' });
    }
  });
}
