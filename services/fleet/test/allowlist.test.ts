import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedUrl } from '../src/allowlist.js';
import { loadConfig } from '../src/config.js';
import { prepareContext } from '../src/providers/prepare.js';
import { serve } from './helpers.js';

describe('isAllowedUrl', () => {
  const allow = ['localhost:4101', 'vistaflix.demo', '*.example.com'];
  it.each([
    ['http://localhost:4101/account', true],
    ['http://localhost:4102/', false], // other port
    ['http://localhost/', false],
    ['https://vistaflix.demo:8443/x', true], // bare hostname matches any port
    ['https://evil-vistaflix.demo/', false],
    ['https://vistaflix.demo.evil.com/', false],
    ['https://a.example.com/', true],
    ['https://example.com/', false], // wildcard is subdomains only
    ['https://a.b.example.com/', true],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['ftp://localhost:4101/', false],
    ['about:blank', true],
    ['not a url', false],
    ['http://LOCALHOST:4101/', true],
    ['http://user@localhost:4101@evil.com/', false],
  ])('%s -> %s', (url, ok) => {
    expect(isAllowedUrl(url, allow)).toBe(ok);
  });

  it('blocks path prefixes even on an allowed host', () => {
    expect(isAllowedUrl('http://localhost:4101/express-fee', allow, ['/express-fee'])).toBe(false);
    expect(isAllowedUrl('http://localhost:4101/express-fee/pay', allow, ['/express-fee'])).toBe(false);
    expect(isAllowedUrl('http://localhost:4101/express-feeds', allow, ['/express-fee'])).toBe(true);
    expect(isAllowedUrl('http://localhost:4101/orders', allow, ['/express-fee'])).toBe(true);
  });
});

describe('route interception, agent header and demo cookie', () => {
  let browser: Browser;
  let b: Awaited<ReturnType<typeof serve>>;
  beforeAll(async () => {
    browser = await chromium.launch();
    b = await serve({ '/pixel.js': ['text/javascript', 'window.offAllowlistLoaded = true;'], '/': '<p>other site</p>' });
  });
  afterAll(async () => {
    await browser.close();
    await b.close();
  });

  it('blocks every off-allowlist request, sends the agent header, scopes the cookie', async () => {
    // Re-serve page with the real origin of b.
    const page0 = `<html><body><h1>allowed</h1><script src="${b.origin}/pixel.js"></script><img src="/express-fee"></body></html>`;
    const a2 = await serve({ '/': page0, '/express-fee': '<p>pay</p>' });
    const cfg = loadConfig({});
    const ctx = await browser.newContext();
    const blocked: string[] = [];
    await prepareContext(ctx, cfg, {
      taskId: 't',
      allowedDomains: [a2.host],
      blockedPaths: ['/express-fee'],
      cookieOrigins: [a2.origin, b.origin],
      onBlocked: (u) => blocked.push(u),
    });
    const page = await ctx.newPage();
    await page.goto(a2.origin + '/');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => (window as unknown as { offAllowlistLoaded?: boolean }).offAllowlistLoaded ?? false)).toBe(false);
    expect(blocked).toContain(`${b.origin}/pixel.js`);
    expect(blocked).toContain(`${a2.origin}/express-fee`);
    expect(b.seen.find((s) => s.path === '/pixel.js')).toBeUndefined();
    await expect(page.goto(b.origin + '/')).rejects.toThrow();
    const hit = a2.seen.find((s) => s.path === '/')!;
    expect(hit.headers['x-overpaid-agent']).toBe('Overpaid agent acting for its user');
    expect(hit.headers.cookie).toContain('demo_session=alex-demo');
    const cookies = await ctx.cookies();
    expect(cookies.map((c) => `${c.domain}:${c.name}`)).toEqual([`127.0.0.1:demo_session`]); // b's origin was not allowlisted
    await ctx.close();
    await a2.close();
  });
});
