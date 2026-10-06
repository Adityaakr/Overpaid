import type { CDPSession, Page } from 'playwright';
import type { Logger } from './log.js';

/**
 * CDP Page.startScreencast for one page. Keeps only the latest JPEG frame; listeners are throttled to `fps`.
 * Chromium only emits frames when the page repaints, so the latest frame stays valid while the page is idle.
 */
export class Screencast {
  private cdp: CDPSession | null = null;
  private latest: Buffer | null = null;
  private listeners = new Set<(jpeg: Buffer) => void>();
  private lastEmit = 0;

  constructor(
    private page: Page,
    private fps: number,
    private log: Logger,
  ) {}

  async start(): Promise<void> {
    try {
      this.cdp = await this.page.context().newCDPSession(this.page);
      this.cdp.on('Page.screencastFrame', (f) => {
        this.latest = Buffer.from(f.data, 'base64');
        this.cdp?.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        const now = Date.now();
        if (now - this.lastEmit >= 1000 / this.fps) {
          this.lastEmit = now;
          for (const l of this.listeners) l(this.latest);
        }
      });
      await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    } catch (err) {
      this.log.warn({ err: String(err) }, 'screencast unavailable; falling back to screenshots');
      this.cdp = null;
    }
  }

  /** Latest frame, or a fresh screenshot when the screencast has not produced one yet. */
  async frame(): Promise<Buffer | null> {
    if (this.latest) return this.latest;
    try {
      this.latest = await this.page.screenshot({ type: 'jpeg', quality: 60 });
    } catch {
      /* page closed */
    }
    return this.latest;
  }

  peek(): Buffer | null {
    return this.latest;
  }

  subscribe(fn: (jpeg: Buffer) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async stop(): Promise<void> {
    const cdp = this.cdp;
    this.cdp = null;
    if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
    if (cdp) await cdp.detach().catch(() => {});
  }
}
