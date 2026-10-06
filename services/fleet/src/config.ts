import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, type MerchantKey } from '@overpaid/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FLEET_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(FLEET_ROOT, '..', '..');

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export type ProviderKind = 'local' | 'agentcore';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const provider = (env.FLEET_PROVIDER || 'local') as ProviderKind;
  if (provider !== 'local' && provider !== 'agentcore') {
    throw new Error(`FLEET_PROVIDER must be "local" or "agentcore", got "${provider}"`);
  }
  return {
    host: env.FLEET_HOST || '127.0.0.1',
    port: envInt(env, 'FLEET_PORT', PORTS.fleet),
    provider,
    maxSessions: envInt(env, 'FLEET_MAX_SESSIONS', 8),
    awsRegion: env.AWS_REGION || 'ap-southeast-1',
    agentcoreBrowserId: env.AGENTCORE_BROWSER_ID || 'aws.browser.v1',
    agentcoreSessionTimeoutSec: envInt(env, 'AGENTCORE_SESSION_TIMEOUT_SECONDS', 900),
    liveViewExpiresSec: envInt(env, 'AGENTCORE_LIVEVIEW_EXPIRES_SECONDS', 300),
    bedrockModelId: env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-5-5',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    modelClient: (env.FLEET_MODEL_CLIENT || 'auto') as 'auto' | 'bedrock' | 'anthropic' | 'none',
    evidenceDir: env.EVIDENCE_DIR ? path.resolve(env.EVIDENCE_DIR) : path.join(REPO_ROOT, 'evidence'),
    headless: env.FLEET_HEADLESS !== 'false',
    merchantPortOffset: envInt(env, 'MERCHANTS_PORT_OFFSET', 0),
    demoCookie: { name: 'demo_session', value: env.DEMO_SESSION_COOKIE || 'alex-demo' },
    agentHeader: { name: 'X-Overpaid-Agent', value: 'Overpaid agent acting for its user' },
    screencastFps: Math.min(4, Math.max(1, envInt(env, 'FLEET_SCREENCAST_FPS', 2))),
    /** Browser-minute price used by the cost meter (AgentCore: 1 vCPU + 4 GB, ~US$0.127/h). */
    browserCentsPerMinute: Number(env.FLEET_BROWSER_CENTS_PER_MINUTE || '0.21'),
    /** Model price per million tokens in cents (Sonnet 5.5: $2 in / $10 out). */
    inputCentsPerMTok: Number(env.FLEET_INPUT_CENTS_PER_MTOK || '200'),
    outputCentsPerMTok: Number(env.FLEET_OUTPUT_CENTS_PER_MTOK || '1000'),
    logLevel: env.LOG_LEVEL || 'info',
  };
}
export type FleetConfig = ReturnType<typeof loadConfig>;

/** Origin of a demo merchant site. MERCHANT_BASE_<KEY> overrides (e.g. a tunnel hostname for AgentCore). */
export function merchantOrigin(cfg: FleetConfig, key: MerchantKey, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[`MERCHANT_BASE_${key.toUpperCase()}`];
  if (override) return override.replace(/\/$/, '');
  return `http://localhost:${PORTS[key] + cfg.merchantPortOffset}`;
}
