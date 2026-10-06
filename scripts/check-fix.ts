// M2 check: the fleet completes every fix recipe with approvals and evidence, three runs in a row.
import { call, ok, sleep } from './check-lib.js';

const RUNS = Number(process.env.RUNS ?? 3);
for (let run = 1; run <= RUNS; run++) {
  await call('/api/demo/reset', {});
  await call('/api/find/run', { mode: 'demo' });
  const { tasks } = await call('/api/fix', { opportunityIds: 'all' });
  ok(tasks.length === 8, `run ${run}: 8 tasks created`);
  let approvals = 0;
  const deadline = Date.now() + Number(process.env.FIX_TIMEOUT_MS ?? 180000);
  for (;;) {
    const pending = await call<any[]>('/api/approvals?state=pending');
    for (const a of pending) {
      await call(`/api/approvals/${a.id}`, { approved: true });
      approvals++;
    }
    const f = await call('/api/tasks');
    const active = f.tasks.filter((t: any) => ['queued', 'running', 'needs_approval'].includes(t.state));
    if (!active.length) break;
    if (Date.now() > deadline) ok(false, `run ${run}: tasks finished in time`);
    await sleep(2000);
  }
  const f = await call('/api/tasks');
  const fleet = f.tasks.filter((t: any) => !t.bySpecialist);
  ok(fleet.every((t: any) => t.state === 'done'), `run ${run}: ${fleet.length} fleet tasks done`);
  ok(fleet.every((t: any) => t.evidenceSha256), `run ${run}: every task has an evidence hash`);
  ok(approvals >= fleet.length, `run ${run}: ${approvals} approvals requested and granted`);
  const receipts = await call<any[]>('/api/receipts');
  ok(receipts.length === fleet.length, `run ${run}: ${receipts.length} recoveries confirmed on status pages, ${(f.recoveredCents / 100).toFixed(2)} USD`);
  ok(f.tasks.some((t: any) => t.bySpecialist && t.state === 'needs_specialist'), `run ${run}: flight claim routed to the specialist`);
}
console.log(`check-fix passed (${RUNS} runs)`);
