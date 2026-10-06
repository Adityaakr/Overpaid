import { chromium, type Browser } from 'playwright';
import type { FleetConfig } from '../config.js';
import { logger } from '../log.js';
import { prepareContext } from './prepare.js';
import { VIEWPORT, type FleetSession, type SessionProvider, type SessionStartOptions } from './types.js';

/** Local Playwright Chromium: one shared browser, one context per task. */
export class LocalProvider implements SessionProvider {
  readonly kind = 'local' as const;
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private live = 0;

  constructor(private cfg: FleetConfig) {}

  async init(): Promise<void> {
    await this.getBrowser();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.launching ??= chromium.launch({ headless: this.cfg.headless }).then((b) => {
      this.browser = b;
      this.launching = null;
      b.on('disconnected', () => {
        if (this.browser === b) this.browser = null;
      });
      return b;
    });
    return this.launching;
  }

  async start(opts: SessionStartOptions): Promise<FleetSession> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ viewport: VIEWPORT, userAgent: undefined });
    await prepareContext(context, this.cfg, opts);
    const page = await context.newPage();
    this.live++;
    let stopped = false;
    const id = `local-${opts.taskId}`;
    return {
      id,
      provider: 'local',
      page,
      context,
      startedAt: Date.now(),
      liveView: async () => ({
        kind: 'frames',
        framePath: `/tasks/${encodeURIComponent(opts.taskId)}/frame.jpg`,
        streamPath: `/tasks/${encodeURIComponent(opts.taskId)}/stream`,
        remoteWidth: VIEWPORT.width,
        remoteHeight: VIEWPORT.height,
      }),
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.live--;
        await context.close().catch((err: unknown) => logger.warn({ err: String(err), taskId: opts.taskId }, 'context close failed'));
      },
    };
  }

  active(): number {
    return this.live;
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    await b?.close().catch(() => {});
  }
}
