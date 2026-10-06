import { PARCELO_WAITING_DAYS, PORTS, type MerchantKey } from '@overpaid/shared';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

const SCHEMA = process.env.MERCHANTS_SCHEMA ?? 'merchants';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error(`MERCHANTS_SCHEMA must be a plain identifier, got "${SCHEMA}"`);

/** All runtime knobs. Delays are wall-clock seconds measured from the moment a request is submitted. */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/overpaid',
  schema: SCHEMA,
  host: process.env.MERCHANTS_HOST ?? '127.0.0.1',
  /** Shift every port by this amount (the e2e tests run an isolated copy on +1000). */
  portOffset: envInt('MERCHANTS_PORT_OFFSET', 0),
  /** Artificial latency added to every HTML page, to make the demo feel like a real site. */
  pageDelayMs: envInt('MERCHANTS_PAGE_DELAY_MS', 0),
  /** Cartwell: "Under review" -> "Refund issued" / "Price adjustment issued". */
  cartwellResolveDelaySeconds: envInt('CARTWELL_RESOLVE_DELAY_SECONDS', 20),
  /** Skylane: "Claim approved" -> "Compensation paid". */
  skylanePaidDelaySeconds: envInt('SKYLANE_PAID_DELAY_SECONDS', 90),
  /** Parcelo: days after the promised date before a non-delivery claim opens. */
  parceloWaitingDays: envInt('PARCELO_WAITING_DAYS', PARCELO_WAITING_DAYS),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};

export const SITES: MerchantKey[] = ['vistaflix', 'cartwell', 'skylane', 'parcelo'];

export const portFor = (k: MerchantKey): number => PORTS[k] + config.portOffset;
