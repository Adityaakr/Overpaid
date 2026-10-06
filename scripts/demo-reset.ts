// pnpm demo:reset: clears ledger, tasks and receipts, and resets every demo merchant. Keeps hires (a running
// long-timer hire must survive a reset). Target: under 60 seconds.
import { call } from './check-lib.js';
const t0 = Date.now();
const r = await call('/api/demo/reset', {});
console.log(`reset in ${Date.now() - t0} ms`, r.merchants);
