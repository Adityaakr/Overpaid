import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { DEMO_USER, MERCHANTS, type MerchantKey } from '@overpaid/shared';
import { config } from './config.js';
import { resetSite, sql } from './db.js';
import { html, raw, table, type SafeHtml } from './html.js';

export const DEMO_COOKIE = 'demo_session';
export const DEMO_COOKIE_VALUE = 'alex-demo';
export const BANNER_TEXT = 'Demo merchant built for the Overpaid hackathon. Not a real company.';
export const AGENT_BADGE_TEXT = 'Request from an AI agent acting for its user';

export type AgentIdentity = {
  isAgent: boolean;
  /** 'web-bot-auth' when HTTP Message Signature headers are present, 'header' for the X-Overpaid-Agent fallback. */
  method: 'web-bot-auth' | 'header' | null;
  /** True only once a real Web Bot Auth verify() has checked the signature. Always false for now. */
  verified: boolean;
  signatureAgent: string | null;
  label: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    agent: AgentIdentity;
    signedIn: boolean;
  }
}

function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * ===== AGENT IDENTIFICATION HOOK =====
 * Decides whether a request comes from an AI agent acting for its user.
 *
 * TODO(web-bot-auth): plug `web-bot-auth` verify() in here. When `Signature`, `Signature-Input` and
 * `Signature-Agent` are present, resolve the key from the `Signature-Agent` directory, verify the
 * signature over the request, and set `verified: true` only on success. Today we record presence only.
 */
export function identifyAgent(req: FastifyRequest): AgentIdentity {
  const signature = header(req, 'signature');
  const signatureInput = header(req, 'signature-input');
  const signatureAgent = header(req, 'signature-agent');
  if (signature || signatureInput || signatureAgent) {
    return { isAgent: true, method: 'web-bot-auth', verified: false, signatureAgent, label: signatureAgent };
  }
  const fallback = header(req, 'x-overpaid-agent');
  if (fallback) return { isAgent: true, method: 'header', verified: false, signatureAgent: null, label: fallback };
  return { isAgent: false, method: null, verified: false, signatureAgent: null, label: null };
}

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export type Theme = { css: string; logo: SafeHtml; nav: { href: string; label: string; testid: string }[]; footer: string };

export type PageOpts = { title: string; body: SafeHtml; status?: number };

export type SiteDef = {
  key: MerchantKey;
  theme: Theme;
  routes: (app: FastifyInstance, ctx: SiteCtx) => void;
  adminSections: () => Promise<{ title: string; rows: Record<string, unknown>[] }[]>;
};

export type SiteCtx = {
  page: (req: FastifyRequest, reply: FastifyReply, opts: PageOpts) => FastifyReply;
};

const BASE_CSS = `
*{box-sizing:border-box}body{margin:0}
.demo-banner{background:#111;color:#ffd84d;font:600 13px/1.4 ui-monospace,Menlo,monospace;text-align:center;padding:6px 12px}
.agent-badge{display:inline-block;margin:8px 16px;padding:3px 10px;border-radius:999px;background:#e8f0ff;color:#1a3a8a;border:1px solid #9db4ef;font:600 12px system-ui,sans-serif}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.admin-table{border-collapse:collapse;font:12px ui-monospace,Menlo,monospace;width:100%;margin-bottom:24px}
.admin-table th,.admin-table td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
.admin-table th{background:#eee}
.muted{opacity:.7}
.error-box{border:2px solid #c0392b;background:#fdecea;color:#7a1d14;padding:12px 16px;border-radius:6px;margin:12px 0}
`;

function layout(site: SiteDef, req: FastifyRequest, opts: PageOpts): string {
  const m = MERCHANTS[site.key];
  const body = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · ${m.name}</title>
<style>${raw(BASE_CSS)}${raw(site.theme.css)}</style>
</head>
<body data-merchant="${site.key}" data-signed-in="${String(req.signedIn)}" data-agent="${String(req.agent.isAgent)}">
<div class="demo-banner" role="note" data-testid="demo-banner">${BANNER_TEXT}</div>
${req.agent.isAgent ? html`<div class="agent-badge" data-testid="agent-badge" data-agent-method="${req.agent.method ?? ''}">${AGENT_BADGE_TEXT}</div>` : ''}
<header class="site-header">
  <a class="logo" href="/" data-testid="home-link" aria-label="${m.name} home">${site.theme.logo}</a>
  <nav aria-label="Main">${site.theme.nav.map((n) => html`<a href="${n.href}" data-testid="${n.testid}">${n.label}</a>`)}</nav>
  ${req.signedIn
    ? html`<span class="signed-in" data-testid="signed-in-as">Signed in as ${DEMO_USER.name} (demo account)</span>`
    : html`<a class="signed-in" href="/demo-login" data-testid="sign-in-link">Sign in</a>`}
</header>
<main id="main">${opts.body}</main>
<footer class="site-footer">${site.theme.footer} · ${m.name} is a fictional company. <a href="/admin">Demo admin</a></footer>
</body></html>`;
  return body.value;
}

function loginPage(next: string): SafeHtml {
  return html`<section class="card login-card">
    <h1>Sign in</h1>
    <p>This is a demo merchant. No real passwords are accepted or stored.</p>
    <form method="get" action="/demo-login">
      <input type="hidden" name="next" value="${next}">
      <button type="submit" class="btn btn-primary" data-testid="demo-login">Continue with the demo account (Alex Rivera)</button>
    </form>
  </section>`;
}

const PUBLIC_PATHS = new Set(['/healthz', '/reset', '/admin', '/admin.json', '/demo-login', '/express-fee']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function safeNext(n: unknown): string {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

export async function buildSite(site: SiteDef): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel, base: { site: site.key } } });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(String(body))) out[k] = v;
    done(null, out);
  });

  app.decorateRequest('agent', null as unknown as AgentIdentity);
  app.decorateRequest('signedIn', false);

  const page: SiteCtx['page'] = (req, reply, opts) =>
    reply.code(opts.status ?? 200).type('text/html; charset=utf-8').send(layout(site, req, opts));

  app.addHook('onRequest', async (req, reply) => {
    req.agent = identifyAgent(req);
    req.signedIn = parseCookies(req.headers.cookie)[DEMO_COOKIE] === DEMO_COOKIE_VALUE;
    const path = req.url.split('?')[0] ?? '/';
    if (config.pageDelayMs > 0 && req.method === 'GET' && !PUBLIC_PATHS.has(path) && !path.endsWith('.json')) {
      await sleep(config.pageDelayMs);
    }
    if (!req.signedIn && !PUBLIC_PATHS.has(path)) {
      if (path.endsWith('.json')) return reply.code(401).send({ error: 'not_signed_in' });
      return page(req, reply, { title: 'Sign in', body: loginPage(req.method === 'GET' ? req.url : '/'), status: 401 });
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (path === '/healthz') return;
    sql`insert into request_log (site, method, path, status, agent, agent_method)
        values (${site.key}, ${req.method}, ${req.url.slice(0, 500)}, ${reply.statusCode}, ${req.agent?.isAgent ?? false}, ${req.agent?.method ?? null})`
      .catch((err: unknown) => app.log.error({ err }, 'request_log insert failed'));
  });

  app.get('/healthz', async () => ({ ok: true, site: site.key }));

  app.get('/demo-login', async (req, reply) => {
    const next = safeNext((req.query as Record<string, unknown>).next);
    return reply
      .header('set-cookie', `${DEMO_COOKIE}=${DEMO_COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax`)
      .redirect(next, 303);
  });

  app.post('/reset', async () => {
    await resetSite(site.key);
    return { ok: true, site: site.key, reset: true };
  });

  const adminData = async () => {
    const sections = await site.adminSections();
    const events = await sql`select id, kind, agent, detail, at from events where site = ${site.key} order by id desc limit 100`;
    const log = await sql`select id, method, path, status, agent, agent_method, at from request_log where site = ${site.key} order by id desc limit 100`;
    return { sections, events: [...events], log: [...log] };
  };

  app.get('/admin', async (req, reply) => {
    const d = await adminData();
    return page(req, reply, {
      title: 'Demo admin',
      body: html`<section class="card admin">
        <h1>Demo admin: ${MERCHANTS[site.key].name}</h1>
        <form method="post" action="/reset" data-testid="admin-reset-form"><button class="btn" type="submit">Reset to seed state</button></form>
        ${d.sections.map((s) => html`<h2>${s.title}</h2>${table(s.rows)}`)}
        <h2>Events (traps, rejections, outcomes)</h2>${table(d.events, 'admin-events')}
        <h2>Request log (latest 100)</h2>${table(d.log, 'admin-request-log')}
      </section>`,
    });
  });
  app.get('/admin.json', async () => adminData());

  site.routes(app, { page });
  return app;
}

/** Shared formatting for amounts in the HTML. */
export const usd = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(cents / 100);

/** Render zod issues as a readable list. */
export function issuesList(messages: string[]): SafeHtml {
  return html`<div class="error-box" role="alert" data-testid="form-errors"><strong>Please fix the following:</strong>
    <ul>${messages.map((m) => html`<li>${m}</li>`)}</ul></div>`;
}

export function secondsSince(d: Date): number {
  return (Date.now() - d.getTime()) / 1000;
}
