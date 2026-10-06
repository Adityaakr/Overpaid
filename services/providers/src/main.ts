/**
 * services/providers boot: three simulated eSIM provider agents. Needs SEED_B (bid keys + payout addresses).
 * Every PROVIDERS_INTERVAL_MS it reads the bloc and re-bids.
 */
import { PORTS } from '@overpaid/shared';
import { BRANDS } from './brands.js';
import { Bidder } from './bidder.js';
import { providerKeys } from './keys.js';
import { buildApp } from './app.js';

const blocUrl = (process.env.BLOC_URL ?? `http://127.0.0.1:${PORTS.bloc}`).replace(/\/+$/, '');
const interval = Number(process.env.PROVIDERS_INTERVAL_MS ?? 20_000);
let bidder: Bidder | null = null;
let reason: string | null = null;
try {
  bidder = new Bidder(BRANDS.map((brand) => ({ brand, keys: providerKeys(brand.key), last: null, lastResult: null })), blocUrl);
} catch (e) {
  reason = (e as Error).message;
  console.warn(`[providers] bidding disabled: ${reason}`);
}

const app = await buildApp({ bidder, reason, blocUrl });
const port = Number(process.env.PROVIDERS_PORT ?? PORTS.providers);
await app.listen({ host: process.env.PROVIDERS_HOST ?? '127.0.0.1', port });
console.log(`[providers] listening on ${port}; bidding against ${blocUrl} every ${interval} ms`);

let timer: NodeJS.Timeout | null = null;
const loop = async () => {
  if (bidder) await bidder.tick().catch((e: Error) => console.warn(`[providers] tick: ${e.message}`));
  timer = setTimeout(() => void loop(), interval);
};
void loop();

const shutdown = async () => {
  if (timer) clearTimeout(timer);
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
