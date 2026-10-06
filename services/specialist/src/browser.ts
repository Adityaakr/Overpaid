/**
 * The specialist's OWN browser session (it shares no process or wallet with Overpaid's fleet).
 * local: Playwright Chromium. agentcore: reuses services/fleet's AgentCore provider (loaded lazily, so the AWS SDK is
 * only needed when FLEET_PROVIDER=agentcore). Both identify the browser as an agent (S2 fallback header) and inject
 * the demo session cookie only for the merchant origin.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const AGENT_HEADER = { name: 'X-Overpaid-Agent', value: 'Overpaid first-party airline-compensation specialist acting for its user' };
export const DEMO_COOKIE = { name: 'demo_session', value: process.env.DEMO_SESSION_COOKIE || 'alex-demo' };

export interface SpecialistSession {
  provider: 'local' | 'agentcore';
  page: Page;
  context: BrowserContext;
  stop(): Promise<void>;
}

let shared: Browser | null = null;

export async function startSession(opts: { provider: 'local' | 'agentcore'; headless: boolean; merchantBaseUrl: string; taskId: string }): Promise<SpecialistSession> {
  const origin = new URL(opts.merchantBaseUrl).origin;
  if (opts.provider === 'agentcore') {
    // Loaded by path at runtime: services/fleet has no package exports and must not be a build-time dependency.
    const cfgMod = '../../fleet/src/config.js';
    const provMod = '../../fleet/src/providers/index.js';
    const { loadConfig } = (await import(cfgMod)) as { loadConfig: () => unknown };
    const { createProvider } = (await import(provMod)) as {
      createProvider: (cfg: unknown) => {
        init(): Promise<void>;
        start(o: { taskId: string; allowedDomains: string[]; cookieOrigins: string[]; onBlocked: (u: string) => void }): Promise<{ page: Page; context: BrowserContext; stop(): Promise<void> }>;
      };
    };
    const provider = createProvider({ ...(loadConfig() as object), provider: 'agentcore' });
    await provider.init();
    const s = await provider.start({ taskId: `specialist-${opts.taskId}`, allowedDomains: [new URL(origin).host], cookieOrigins: [origin], onBlocked: () => {} });
    return { provider: 'agentcore', page: s.page, context: s.context, stop: () => s.stop() };
  }
  if (!shared?.isConnected()) shared = await chromium.launch({ headless: opts.headless });
  const context = await shared.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { [AGENT_HEADER.name]: AGENT_HEADER.value } });
  await context.addCookies([{ name: DEMO_COOKIE.name, value: DEMO_COOKIE.value, url: origin, sameSite: 'Lax' }]);
  // Only the merchant origin is reachable from this session.
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin) || u.startsWith('about:') || u.startsWith('data:')) return route.fallback();
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  return { provider: 'local', page, context, stop: () => context.close() };
}

export async function closeBrowser(): Promise<void> {
  await shared?.close().catch(() => {});
  shared = null;
}
