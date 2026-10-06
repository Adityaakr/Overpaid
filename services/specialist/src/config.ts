import path from 'node:path';
import { merchantUrl, PORTS } from '@overpaid/shared';
import { blockfrostConfig, REPO_ROOT, type BlockfrostConfig } from '@overpaid/cardano';

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = envInt(env, 'SPECIALIST_PORT', PORTS.specialist);
  const publicUrl = (env.SPECIALIST_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const bf: BlockfrostConfig | null = blockfrostConfig(env);
  return {
    host: env.SPECIALIST_HOST || '127.0.0.1',
    port,
    publicUrl,
    /** Fee in lovelace. Priced in tADA on preprod (label it so in the UI). */
    priceLovelace: BigInt(env.SPECIALIST_PRICE_LOVELACE || '5000000'),
    /** x402 maxTimeoutSeconds: payByTime = quote time + this. */
    maxTimeoutSeconds: envInt(env, 'SPECIALIST_MAX_TIMEOUT_SECONDS', 300),
    /** Escrow deadlines after payByTime (x402 defaults 15/35/55 min). */
    deadlines: {
      submitResultAfterPayByMs: envInt(env, 'SPECIALIST_SUBMIT_AFTER_PAYBY_MS', 15 * 60_000),
      unlockAfterPayByMs: envInt(env, 'SPECIALIST_UNLOCK_AFTER_PAYBY_MS', 35 * 60_000),
      externalDisputeUnlockAfterPayByMs: envInt(env, 'SPECIALIST_DISPUTE_AFTER_PAYBY_MS', 55 * 60_000),
    },
    /** l1Confirmations quoted in the 402 (0 = included in a block, 1 = one block deeper). */
    l1Confirmations: envInt(env, 'SPECIALIST_L1_CONFIRMATIONS', 1),
    /** Optional registry identifier (120 hex) once registered; unregistered by default. */
    agentIdentifier: env.MASUMI_AGENT_IDENTIFIER || undefined,
    blockfrost: bf,
    databaseUrl: env.DATABASE_URL || 'postgres://localhost:5432/overpaid',
    skylaneBaseUrl: (env.MERCHANT_BASE_SKYLANE || merchantUrl('skylane')).replace(/\/+$/, ''),
    evidenceDir: env.EVIDENCE_DIR ? path.resolve(env.EVIDENCE_DIR) : path.join(REPO_ROOT, 'evidence'),
    watchIntervalMs: envInt(env, 'SPECIALIST_WATCH_INTERVAL_MS', 10_000),
    browserProvider: (env.FLEET_PROVIDER === 'agentcore' ? 'agentcore' : 'local') as 'local' | 'agentcore',
    headless: env.FLEET_HEADLESS !== 'false',
    /** How long to wait for "Compensation paid" before giving up (also capped by submitResultTime). */
    paidTimeoutMs: envInt(env, 'SPECIALIST_PAID_TIMEOUT_MS', 8 * 60_000),
    /** Stop trying to submit this long before submit_result_time. */
    submitMarginMs: envInt(env, 'SPECIALIST_SUBMIT_MARGIN_MS', 5 * 60_000),
    /** Fail a lock not seen this long after payByTime. */
    payByMarginMs: envInt(env, 'SPECIALIST_PAYBY_MARGIN_MS', 5 * 60_000),
    /** Collect automatically once chain time passes unlockTime + this. */
    collectDelayMs: envInt(env, 'SPECIALIST_COLLECT_DELAY_MS', 30_000),
    autoCollect: env.SPECIALIST_AUTO_COLLECT !== 'false',
    quoteRatePerMinute: envInt(env, 'SPECIALIST_QUOTES_PER_MINUTE', 30),
    agentName: env.AGENT_NAME || 'Overpaid Airline Compensation Specialist (first party)',
  };
}
export type SpecialistConfig = ReturnType<typeof loadConfig>;
