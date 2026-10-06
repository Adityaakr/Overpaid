// Runs the specialist's off-chain work end to end without any chain: file the Skylane claim in its own browser
// session, wait for "Compensation paid" on the status page, build the evidence bundle and print its hash.
// This is exactly what the watcher does after it sees a matching escrow lock (src/watcher.ts).
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { merchantUrl, SKYLANE_FLIGHT, DEMO_USER } from '@overpaid/shared';
import { startSession, closeBrowser } from '../src/browser.js';
import { EvidenceRecorder, fileClaim, waitForPaid, buildManifest, writeEvidence } from '../src/work.js';
import { TaskSpec } from '../src/jobs.js';

const base = merchantUrl('skylane');
await fetch(`${base}/reset`, { method: 'POST' });
const jobId = randomUUID();
const dir = path.resolve(import.meta.dirname, '../../../evidence/specialist', jobId);
const recorder = new EvidenceRecorder(dir);
await recorder.init();
const task = TaskSpec.parse({ merchant: 'skylane', booking_ref: SKYLANE_FLIGHT.bookingRef, passenger_name: DEMO_USER.name });
const t0 = Date.now();
const s = await startSession({ provider: 'local', headless: true, merchantBaseUrl: base, taskId: jobId });
const filed = await fileClaim(s.page, { baseUrl: base, task, recorder });
console.log(`claim filed: ${filed.claimId} (${filed.mode}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const observed = await waitForPaid(base, filed.claimId, Date.now() + 10 * 60_000, 3000);
console.log(`status page: ${observed.statusLabel} ${(observed.amountCents / 100).toFixed(2)} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const manifest = buildManifest({ jobId, claimId: filed.claimId, recorder, observed });
const { resultHash, manifestPath } = await writeEvidence(dir, manifest, observed);
console.log(`evidence ${manifestPath}\nresult hash ${resultHash}`);
await s.stop();
await closeBrowser();
