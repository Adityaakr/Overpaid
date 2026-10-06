// Refund paths on preprod (docs/BRIEF.md M3 step 7). Usage: tsx scripts/check-refund.ts a|b
//  (a) no result: buyer SetRefundRequested, then WithdrawRefund after submitResultTime.
//  (b) result then dispute: buyer SetRefundRequested (-> Disputed), seller AuthorizeRefund, buyer WithdrawRefund.
import { account, hireSpecialist, requestRefund, withdrawRefund, blockfrostConfig, txUrl } from '@overpaid/cardano';
import { DEMO_USER, SKYLANE_FLIGHT } from '@overpaid/shared';
import { ok, sleep } from './check-lib.js';

const path = process.argv[2];
if (path !== 'a' && path !== 'b') throw new Error('usage: check-refund.ts a|b');
if (!blockfrostConfig()) {
  console.log('SKIP check-refund: needs BLOCKFROST_PROJECT_ID');
  process.exit(2);
}
const SPEC = process.env.SPECIALIST_URL ?? 'http://127.0.0.1:4200';
const buyer = account('overpaid-buyer');
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] (${path}) ${m}`);

// Retries a chain action until its validity window or cooldown opens.
async function retry<T>(label: string, fn: () => Promise<T>, maxMin = 40): Promise<T> {
  const end = Date.now() + maxMin * 60_000;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() > end) throw e;
      log(`${label} not yet: ${(e as Error).message.slice(0, 140)}`);
      await sleep(30_000);
    }
  }
}
async function job(lock: string) {
  return (await fetch(`${SPEC}/jobs/by-tx/${lock}`).then((r) => r.json())) as any;
}

// (a) hires for a booking that doesn't exist, so the specialist can never confirm an outcome and never submits.
const task = {
  merchant: 'skylane',
  vigil: 'flight_compensation',
  booking_ref: path === 'a' ? 'ZZZZZZ' : SKYLANE_FLIGHT.bookingRef,
  passenger_name: DEMO_USER.name,
  payout: 'original_card',
};
const hire = await hireSpecialist({ specialistUrl: SPEC, task, buyer });
const h = { txLock: hire.txLock, blockchainIdentifier: hire.blockchainIdentifier };
log(`locked ${txUrl(hire.txLock)}; submitResultTime ${new Date(hire.submitResultTime).toLocaleTimeString()}, unlock ${new Date(hire.unlockTime).toLocaleTimeString()}`);

if (path === 'b') {
  for (;;) {
    const j = await job(hire.txLock);
    if (j?.escrow?.resultTx) {
      log(`result submitted ${txUrl(j.escrow.resultTx)}`);
      break;
    }
    await sleep(10_000);
  }
}

const req = await retry('SetRefundRequested', () => requestRefund(buyer, h));
log(`SetRefundRequested ${txUrl((req as any).txHash)} (${path === 'a' ? 'RefundRequested' : 'Disputed'})`);

if (path === 'b') {
  const j = await job(hire.txLock);
  const auth = await retry('AuthorizeRefund', async () => {
    const r = await fetch(`${SPEC}/admin/authorize-refund/${j.job_id}`, { method: 'POST' });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? r.status);
    return body;
  });
  log(`seller AuthorizeRefund ${JSON.stringify(auth).slice(0, 160)}`);
}

const w = await retry('WithdrawRefund', () => withdrawRefund(buyer, h), 45);
ok((w as any).txHash, `refund path (${path}) withdrawn to the buyer ${txUrl((w as any).txHash)}`);
console.log(`check-refund-${path} passed`);
