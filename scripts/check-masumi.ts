// M3 check (spike B): hire the specialist over x402 masumi, see the lock and the result hash land on preprod.
import { account, blockfrostConfig } from '@overpaid/cardano';
import { call, ok, sleep } from './check-lib.js';

if (!blockfrostConfig()) {
  console.log(`SKIP check-masumi: needs BLOCKFROST_PROJECT_ID, and the buyer funded (about 20 tADA) at ${account('overpaid-buyer').address}, plus the seller (about 20 tADA) at ${account('specialist-seller').address}`);
  process.exit(2);
}
const hire = await call('/api/hires', { longTimer: false });
ok(hire.txLock, `escrow lock submitted ${hire.txLockUrl}`);
const deadline = Date.now() + 25 * 60_000;
for (;;) {
  const s = await call('/api/specialist');
  const h = s.hires.find((x: any) => x.id === hire.id);
  if (h?.txResult) {
    ok(h.resultHash, `result submitted ${h.txResult} with evidence hash ${h.resultHash}`);
    ok(/both match/.test(h.note ?? ''), 'Overpaid re-checked the status page and the evidence hash');
    break;
  }
  if (Date.now() > deadline) ok(false, 'result submitted within 25 minutes');
  await sleep(10_000);
}
console.log(`check-masumi passed. Collection is possible after unlock: ${new Date(hire.unlockTime).toLocaleTimeString()}`);
