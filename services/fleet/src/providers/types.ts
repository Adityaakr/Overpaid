import type { BrowserContext, Page } from 'playwright';
import type { ProviderKind } from '../config.js';

export const VIEWPORT = { width: 1280, height: 800 } as const;

export type LiveViewInfo =
  | { kind: 'frames'; framePath: string; streamPath: string; remoteWidth: number; remoteHeight: number }
  | { kind: 'dcv'; signedUrl: string; expiresAt: string; remoteWidth: number; remoteHeight: number };

export interface SessionStartOptions {
  taskId: string;
  /** Rendered allowlist patterns for route interception. */
  allowedDomains: string[];
  blockedPaths: string[];
  /** Origins that receive the demo session cookie (must be allowlisted). */
  cookieOrigins: string[];
  /** Called for every request blocked by the allowlist. */
  onBlocked: (url: string) => void;
}

export interface FleetSession {
  readonly id: string;
  readonly provider: ProviderKind;
  readonly page: Page;
  readonly context: BrowserContext;
  readonly startedAt: number;
  liveView(): Promise<LiveViewInfo>;
  stop(): Promise<void>;
}

export interface SessionProvider {
  readonly kind: ProviderKind;
  /** Throws with a clear message if the provider cannot run (e.g. no AWS credentials). */
  init(): Promise<void>;
  start(opts: SessionStartOptions): Promise<FleetSession>;
  active(): number;
  close(): Promise<void>;
}
