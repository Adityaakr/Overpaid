import path from 'node:path';
import { PORTS } from '@overpaid/shared';
import { REPO_ROOT } from '@overpaid/cardano';
import { DEFAULT_N_MAX } from './units.js';

export interface BlocConfig {
  host: string;
  port: number;
  /** Public origin of the web app's join page (e.g. the tunnel URL); null hides the QR. */
  publicBaseUrl: string | null;
  providersUrl: string;
  nMax: number;
  stateFile: string | null;
  /** Join tokens + next room slot (default: next to the state file). */
  tokensFile: string | null;
  /** Auto-refund ticker period (0 disables it). */
  autoRefundMs: number;
  /** If set, /admin/* requires header `x-admin-token`. */
  adminToken: string | null;
  joinPerIp: number;
  simulateBatchSize: number;
  simulateIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BlocConfig {
  const n = Number(env.BLOC_N_MAX ?? DEFAULT_N_MAX);
  const stateFile = env.BLOC_STATE_FILE === '' ? null : (env.BLOC_STATE_FILE ?? path.join(REPO_ROOT, 'data', 'bloc', 'state.json'));
  return {
    host: env.BLOC_HOST ?? '127.0.0.1',
    port: Number(env.BLOC_PORT ?? PORTS.bloc),
    publicBaseUrl: env.PUBLIC_BASE_URL ? env.PUBLIC_BASE_URL.replace(/\/+$/, '') : null,
    providersUrl: (env.PROVIDERS_URL ?? `http://127.0.0.1:${PORTS.providers}`).replace(/\/+$/, ''),
    nMax: Number.isInteger(n) && n > 0 ? n : DEFAULT_N_MAX,
    stateFile,
    tokensFile: stateFile ? path.join(path.dirname(stateFile), 'join-tokens.json') : null,
    autoRefundMs: Number(env.BLOC_AUTO_REFUND_MS ?? 60_000),
    adminToken: env.BLOC_ADMIN_TOKEN || null,
    joinPerIp: Number(env.BLOC_JOIN_PER_IP ?? 3),
    simulateBatchSize: Number(env.BLOC_SIM_BATCH ?? 60),
    simulateIntervalMs: Number(env.BLOC_SIM_INTERVAL_MS ?? 30_000),
  };
}
