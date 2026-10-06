/**
 * services/bloc boot. Without BLOCKFROST_PROJECT_ID (or seeds A/C) the service still serves /state, /bids and the
 * admin join tokens; chain routes answer 503 with the reason.
 */
import { chainReadiness, makeChain } from './chain.js';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { BlocStore } from './store.js';

const cfg = loadConfig();
const store = new BlocStore(cfg.stateFile);
const chainReason = chainReadiness();
const chain = chainReason ? null : makeChain();
if (!chain) console.warn(`[bloc] chain disabled: ${chainReason}`);

const app = await buildApp({ cfg, store, chain, chainReason });
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`[bloc] listening on http://${cfg.host}:${cfg.port} (N_max ${cfg.nMax}; public ${cfg.publicBaseUrl ?? 'unset'})`);

const shutdown = async () => {
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
