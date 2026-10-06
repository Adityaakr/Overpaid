/**
 * Boot: seller wallet = specialist-seller (seed A, account 1). Without BLOCKFROST_PROJECT_ID the service still serves
 * MIP-003 and 402 quotes, but verify/settle and the watcher are disabled and say so.
 */
import { account, addressUrl, blockfrost, DEFAULT_BLOCKFROST_BASE_URL, escrowScript, inProcessFacilitator } from '@overpaid/cardano';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeOffer } from './offer.js';
import { PgJobStore, PgTermsStorage } from './store.js';
import { chainOps, Watcher } from './watcher.js';
import { closeBrowser } from './browser.js';

const cfg = loadConfig();
escrowScript(); // asserts the rebuilt vested_pay v2 script matches the canonical preprod escrow
const seller = account('specialist-seller');
const store = new PgJobStore(cfg.databaseUrl);
await store.init();
const terms = new PgTermsStorage(store.sql);
await terms.prune().catch(() => {});

const facilitator = inProcessFacilitator(cfg.blockfrost ?? { baseUrl: DEFAULT_BLOCKFROST_BASE_URL, projectId: '' });
const offer = await makeOffer(cfg, { seller: seller.masumiSeller(), facilitator, storage: terms, log: (m) => console.warn(m) });

let watcher: Watcher | null = null;
if (cfg.blockfrost) {
  watcher = new Watcher(cfg, store, chainOps(blockfrost(cfg.blockfrost), seller));
  await watcher.recover();
  watcher.start();
} else {
  console.warn('[specialist] BLOCKFROST_PROJECT_ID is not set: serving quotes only; payments cannot be verified or settled and the watcher is off.');
}

const app = await buildApp({ cfg, store, offer, sellerAddress: seller.address, watcher, chainReady: Boolean(cfg.blockfrost) });
await app.listen({ host: cfg.host, port: cfg.port });
console.log(`[specialist] listening on http://${cfg.host}:${cfg.port} (public ${cfg.publicUrl}); seller ${seller.address} ${addressUrl(seller.address)}; fee ${cfg.priceLovelace} lovelace (tADA, preprod)`);

const shutdown = async () => {
  watcher?.stop();
  await app.close().catch(() => {});
  await closeBrowser();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
