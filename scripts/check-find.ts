// M1 check: Find produces the expected ledger in under 60 seconds.
import { EXPECTED_FIX_TASKS } from '@overpaid/shared';
import { call, ok } from './check-lib.js';

await call('/api/demo/reset', {});
const t0 = Date.now();
const run = await call('/api/find/run', { mode: 'demo' });
const ms = Date.now() - t0;
const ledger = await call('/api/ledger');
ok(ms < 60000, `find ran in ${ms} ms (< 60000)`);
ok(ledger.count === EXPECTED_FIX_TASKS.length + 1, `${ledger.count} ledger lines (8 fixes + 1 bloc candidate)`);
for (const e of EXPECTED_FIX_TASKS) {
  const hit = ledger.items.find((i: any) => i.vigilType === e.vigil && i.meta?.ref === e.ref);
  ok(hit && hit.reason && hit.sources.length, `${e.vigil} ${e.ref} found with a reason and ${hit?.sources.length ?? 0} sources`);
}
ok(ledger.total === run.totalCents && ledger.total > 0, `money on the table ${(ledger.total / 100).toFixed(2)} USD`);
console.log('check-find passed');
