import type { BrowserContext } from 'playwright';
import { isAllowedUrl } from '../allowlist.js';
import type { FleetConfig } from '../config.js';
import type { SessionStartOptions } from './types.js';

/**
 * Applied to every browser context, local or AgentCore:
 * - S2 fallback: a plain header naming the browser as an agent acting for its user, on every request.
 * - demo session cookie, only for allowlisted merchant origins.
 * - route interception: every request (documents, XHR, subresources) off the allowlist is aborted.
 */
export async function prepareContext(ctx: BrowserContext, cfg: FleetConfig, opts: SessionStartOptions): Promise<void> {
  await ctx.setExtraHTTPHeaders({ [cfg.agentHeader.name]: cfg.agentHeader.value });
  const cookieOrigins = opts.cookieOrigins.filter((o) => isAllowedUrl(o, opts.allowedDomains));
  if (cookieOrigins.length) {
    await ctx.addCookies(
      cookieOrigins.map((url) => ({ name: cfg.demoCookie.name, value: cfg.demoCookie.value, url, sameSite: 'Lax' as const })),
    );
  }
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (isAllowedUrl(url, opts.allowedDomains, opts.blockedPaths)) return route.fallback();
    opts.onBlocked(url);
    return route.abort('blockedbyclient');
  });
}
