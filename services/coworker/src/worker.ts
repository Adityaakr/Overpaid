// Polls Sokosumi for Tasks assigned to this Coworker and runs each one once. One worker per Coworker.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildReport } from './report.js';
import { advancePaid, type Paid } from './paid.js';
import { LOCAL, registration } from './mps.js';
import { cli, COWORKER_ID, SCOPES, type Scope } from './sokosumi.js';

if (!/^[0-9a-f-]{36}$/i.test(COWORKER_ID)) throw new Error('Set COWORKER_ID');
const PAID = process.env.PAID_TASKS_ENABLED === 'true';
const dir = join(LOCAL, 'tasks');
mkdirSync(dir, { recursive: true, mode: 0o700 });

// Single-instance lock: a second worker would execute the same Task twice.
const lock = join(LOCAL, 'worker.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  try {
    process.kill(pid, 0);
    throw new Error(`Worker already running: ${pid}`);
  } catch (e: any) {
    if (e.code !== 'ESRCH') throw e;
    unlinkSync(lock);
  }
}
closeSync(openSync(lock, 'wx', 0o600));
writeFileSync(lock, String(process.pid));
const release = () => existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid) && unlinkSync(lock);
process.once('exit', release);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.once(s, () => process.exit(0));

interface Journal {
  phase: 'starting' | 'started' | 'model-pending' | 'result-saved' | 'complete-pending' | 'completed';
  input?: string;
  paid?: Paid;
  completion?: unknown;
  model?: string;
}
// Watchdog: the local payment service's periodic chain sync sometimes stops seeing new transactions, while its
// startup sync always catches up. If a paid Task sits in a waiting stage too long, restart the service (the
// run-mps.sh supervisor brings it back). Opt in with MPS_WATCHDOG=1.
const waiting = new Map<string, { stage: string; since: number }>();
let lastRestart = 0;
function watch(taskId: string, stage: string | undefined, unlockAt?: number) {
  if (process.env.MPS_WATCHDOG !== '1') return;
  // Payout normally waits for unlock (plus the contract's delay); only a wait past that is suspicious.
  const idle = stage === 'awaiting-withdrawal' && (!unlockAt || Date.now() < unlockAt + 5 * 60_000);
  if (!stage || idle || !/^awaiting-(escrow|result|withdrawal)$/.test(stage)) return void waiting.delete(taskId);
  const w = waiting.get(taskId);
  if (!w || w.stage !== stage) return void waiting.set(taskId, { stage, since: Date.now() });
  if (Date.now() - w.since > 120_000 && Date.now() - lastRestart > 180_000) {
    lastRestart = Date.now();
    w.since = Date.now();
    console.log('watchdog: payment service sync looks stale, restarting it', taskId, stage);
    try {
      execFileSync('pkill', ['-f', 'tsx ./src/index.ts']);
    } catch {}
  }
}

const jPath = (id: string) => join(dir, `${id}.json`);
const load = (id: string): Journal | null => (existsSync(jPath(id)) ? JSON.parse(readFileSync(jPath(id), 'utf8')) : null);
const save = (id: string, j: Journal) => writeFileSync(jPath(id), JSON.stringify(j, null, 2), { mode: 0o600 });

async function answer(id: string, input: string, deadline?: number) {
  const ac = new AbortController();
  const t = deadline ? setTimeout(() => ac.abort(), Math.max(1000, deadline - Date.now() - 60_000)) : undefined;
  try {
    const r = await buildReport(input, { signal: ac.signal });
    writeFileSync(join(dir, `${id}.txt`), r.text, { mode: 0o600 });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function step(t: { id: string; status: string; coworkerId?: string }, scope: Scope) {
  let j = load(t.id);
  if (t.status === 'READY' && !j) {
    save(t.id, { phase: 'starting' });
    const started = cli(['runtime', 'start', t.id, '--coworker-id', COWORKER_ID, ...scope.runtime]);
    j = { phase: 'started', input: started.description ?? started.task?.description ?? '' };
    save(t.id, j);
    console.log('started', t.id);
  }
  if (!j || j.phase === 'completed' && !j.paid) return;
  if (j.phase === 'starting' || j.phase.endsWith('-pending') && !j.paid) throw new Error(`Uncertain ${j.phase}; inspect before recovery`);

  if (j.paid || (j.phase === 'started' && PAID && registration())) {
    if (j.paid?.stage === 'settled' || j.paid?.stage === 'payment-failed') return;
    const cur: Journal = j;
    const r = await advancePaid(t.id, cur.input ?? '', cur.paid, (p) => save(t.id, { ...cur, paid: p }), async (input, deadline) => (await answer(t.id, input, deadline)).text);
    save(t.id, { ...cur, paid: r.paid, phase: r.completed ? 'completed' : cur.phase });
    watch(t.id, r.paid.stage, Number(r.paid.payment?.unlockTime) || undefined);
    if (r.paid.stage !== cur.paid?.stage) console.log('paid', t.id, r.paid.stage);
    return;
  }

  if (j.phase === 'started') {
    save(t.id, { ...j, phase: 'model-pending' });
    const r = await answer(t.id, j.input ?? '');
    j = { ...j, phase: 'result-saved', model: r.model };
    save(t.id, j);
  }
  if (j.phase === 'result-saved') {
    save(t.id, { ...j, phase: 'complete-pending' });
    const completion = cli(['runtime', 'complete', t.id, '--coworker-id', COWORKER_ID, ...scope.runtime, '--result-file', join(dir, `${t.id}.txt`)]);
    save(t.id, { ...j, phase: 'completed', completion });
    console.log('completed', t.id);
  }
}

console.log(`coworker worker ${process.pid} for ${COWORKER_ID} (${PAID ? 'paid' : 'unpaid'} Tasks) in ${SCOPES.map((s) => s.name).join(', ')}`);
for (;;) {
  for (const scope of SCOPES) {
    try {
      const { tasks } = cli<{ tasks: any[] }>(['tasks', 'list', '--coworker-id', COWORKER_ID, ...scope.list]);
      for (const t of tasks.filter((x) => !x.coworkerId || x.coworkerId === COWORKER_ID)) {
        try {
          await step(t, scope);
        } catch (e) {
          console.error('task blocked', scope.name, t.id, String((e as Error).message).slice(0, 200));
        }
      }
    } catch (e) {
      console.error('poll failed', scope.name, String((e as Error).message).slice(0, 200));
    }
  }
  await new Promise((r) => setTimeout(r, 5000));
}
