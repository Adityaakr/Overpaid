import { chromium, type Browser, type Page } from 'playwright';
import type { FleetConfig } from './config.js';
import type { ResolvedRecipe } from './recipes.js';

export interface Verification {
  /** The merchant accepted the request (status in successValues or finalValues). */
  ok: boolean;
  /** The money is actually recovered (status in finalValues, or in successValues when no finalValues are defined). */
  final: boolean;
  status: string | null;
  confirmationCode: string | null;
  amountCents: number | null;
  excerpt: string;
  screenshot: Buffer | null;
  detail: string;
}

/**
 * Re-reads the merchant's status page in a FRESH context of the fleet's own local Chromium (never the agent's
 * page, never the agent's claim) and reads data-status / data-confirmation / data-amount-cents.
 */
export class Verifier {
  private browser: Promise<Browser> | null = null;
  constructor(private cfg: FleetConfig) {}

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: true });
    return this.browser;
  }

  async verify(r: ResolvedRecipe, waitSeconds = 30): Promise<Verification> {
    const browser = await this.getBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      await ctx.setExtraHTTPHeaders({ [this.cfg.agentHeader.name]: this.cfg.agentHeader.value });
      await ctx.addCookies([{ name: this.cfg.demoCookie.name, value: this.cfg.demoCookie.value, url: r.origin, sameSite: 'Lax' }]);
      const page = await ctx.newPage();
      const sig = r.recipe.successSignal;
      if (!sig) throw new Error('recipe has no success signal to verify');
      const deadline = Date.now() + waitSeconds * 1000;
      const accept = new Set([...sig.successValues, ...sig.finalValues]);
      const isFinal = (st: string | null) => st !== null && (sig.finalValues.length ? sig.finalValues.includes(st) : sig.successValues.includes(st));
      let last: Verification = { ok: false, final: false, status: null, confirmationCode: null, amountCents: null, excerpt: '', screenshot: null, detail: 'not checked' };
      for (;;) {
        last = await this.readOnce(page, r);
        if (isFinal(last.status)) break;
        if (Date.now() >= deadline) break;
        await new Promise((res) => setTimeout(res, 1500));
      }
      last.ok = last.status !== null && accept.has(last.status);
      last.final = isFinal(last.status);
      last.screenshot = await page.screenshot({ type: 'png' }).catch(() => null);
      return last;
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  private async readOnce(page: Page, r: ResolvedRecipe): Promise<Verification> {
    const sig = r.recipe.successSignal!;
    const base: Verification = { ok: false, final: false, status: null, confirmationCode: null, amountCents: null, excerpt: '', screenshot: null, detail: '' };
    try {
      await page.goto(r.statusUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (r.followLink) {
        const links = page.locator(r.followLink);
        const n = await links.count();
        if (n === 0) return { ...base, detail: `no ${r.followLink} link on ${r.statusUrl}` };
        const href = await links.nth(n - 1).getAttribute('href');
        if (!href) return { ...base, detail: `link ${r.followLink} has no href` };
        const target = new URL(href, page.url());
        if (target.origin !== new URL(r.origin).origin) return { ...base, detail: `link points off the merchant origin: ${target.href}` };
        await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
      const el = page.locator(r.statusSelector).first();
      if ((await el.count()) === 0) return { ...base, detail: `selector ${r.statusSelector} not found on ${page.url()}` };
      const status = await el.getAttribute(sig.statusAttr);
      const conf = await el.getAttribute(sig.confirmationAttr);
      const amt = await el.getAttribute(sig.amountAttr);
      return {
        ...base,
        status,
        confirmationCode: conf || null,
        amountCents: amt !== null && amt !== '' && Number.isFinite(Number(amt)) ? Number(amt) : null,
        excerpt: ((await el.innerText().catch(() => '')) || '').slice(0, 500),
        detail: `status=${status ?? '(none)'} at ${page.url()}`,
      };
    } catch (e) {
      return { ...base, detail: `status page unreachable: ${(e as Error).message.split('\n')[0]}` };
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b).close().catch(() => {});
  }
}
