import { chromium } from 'playwright';
import type { FleetConfig } from '../config.js';
import { logger } from '../log.js';
import { prepareContext } from './prepare.js';
import { VIEWPORT, type FleetSession, type LiveViewInfo, type SessionProvider, type SessionStartOptions } from './types.js';

/** Probe the default AWS credential chain (env, profile/SSO, container, instance role). */
export async function awsCredentialsAvailable(): Promise<boolean> {
  try {
    const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers');
    const creds = await fromNodeProviderChain()();
    return Boolean(creds.accessKeyId);
  } catch {
    return false;
  }
}

/**
 * AWS Bedrock AgentCore Browser (docs/research/agentcore-browser.md section 3).
 * One base `Browser` instance per session (an instance holds exactly one session). We own the Playwright Page by
 * connecting over CDP with the SigV4 headers from generateWebSocketUrl(), so the agent loop is identical to local.
 */
export class AgentCoreProvider implements SessionProvider {
  readonly kind = 'agentcore' as const;
  private sessions = new Set<FleetSession>();

  constructor(private cfg: FleetConfig) {}

  async init(): Promise<void> {
    if (!(await awsCredentialsAvailable())) {
      throw new Error(
        'FLEET_PROVIDER=agentcore but no AWS credentials were found on the default chain ' +
          '(AWS_ACCESS_KEY_ID/AWS_PROFILE/SSO/role). Set credentials or use FLEET_PROVIDER=local.',
      );
    }
    // Load the SDK eagerly so a broken install fails at startup, not mid-demo.
    await import('bedrock-agentcore/browser');
    logger.info(
      { region: this.cfg.awsRegion, identifier: this.cfg.agentcoreBrowserId, timeoutSec: this.cfg.agentcoreSessionTimeoutSec },
      'agentcore provider ready',
    );
  }

  async start(opts: SessionStartOptions): Promise<FleetSession> {
    const { Browser } = await import('bedrock-agentcore/browser');
    // Region passed explicitly: the SDK default is us-west-2.
    const ac = new Browser({ region: this.cfg.awsRegion, identifier: this.cfg.agentcoreBrowserId });
    const info = await ac.startSession({
      sessionName: `overpaid-${opts.taskId}`.slice(0, 100),
      timeout: this.cfg.agentcoreSessionTimeoutSec, // sent as sessionTimeoutSeconds; sessions bill until stopped
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    });
    let cdp: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
    try {
      const ws = await ac.generateWebSocketUrl();
      cdp = await chromium.connectOverCDP({ endpointURL: ws.url, headers: ws.headers });
      const context = cdp.contexts()[0] ?? (await cdp.newContext({ viewport: VIEWPORT }));
      await prepareContext(context, this.cfg, opts);
      const page = context.pages()[0] ?? (await context.newPage());
      await page.setViewportSize(VIEWPORT).catch(() => {});

      // Live-view URLs are SigV4-presigned and expire (default 300 s). Re-sign on demand before expiry.
      let cached: { url: string; expiresAtMs: number } | null = null;
      const expires = this.cfg.liveViewExpiresSec;
      const liveView = async (): Promise<LiveViewInfo> => {
        if (!cached || cached.expiresAtMs - Date.now() < 60_000) {
          const url = await ac.generateLiveViewUrl(expires);
          cached = { url, expiresAtMs: Date.now() + expires * 1000 };
        }
        return {
          kind: 'dcv',
          signedUrl: cached.url,
          expiresAt: new Date(cached.expiresAtMs).toISOString(),
          remoteWidth: VIEWPORT.width,
          remoteHeight: VIEWPORT.height,
        };
      };

      let stopped = false;
      const conn = cdp;
      const session: FleetSession = {
        id: info.sessionId,
        provider: 'agentcore',
        page,
        context,
        startedAt: Date.now(),
        liveView,
        stop: async () => {
          if (stopped) return;
          stopped = true;
          this.sessions.delete(session);
          await conn.close().catch(() => {});
          await ac.stopSession().catch((err: unknown) => logger.warn({ err: String(err), taskId: opts.taskId }, 'stopSession failed'));
        },
      };
      this.sessions.add(session);
      return session;
    } catch (err) {
      await cdp?.close().catch(() => {});
      await ac.stopSession().catch(() => {});
      throw err;
    }
  }

  active(): number {
    return this.sessions.size;
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions].map((s) => s.stop()));
  }
}
