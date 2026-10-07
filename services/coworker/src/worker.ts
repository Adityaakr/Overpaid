// Polls Sokosumi for Tasks assigned to this Coworker and runs each one once. One worker per Coworker.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport } from './report.js';
import { advancePaid, type Paid } from './paid.js';
import { LOCAL, registration } from './mps.js';
import { cli, COWORKER_ID, scope } from './sokosumi.js';

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

async function step(t: { id: string; status: string; coworkerId?: string }) {
  let j = load(t.id);
  if (t.status === 'READY' && !j) {
    save(t.id, { phase: 'starting' });
    const started = cli(['runtime', 'start', t.id, '--coworker-id', COWORKER_ID, ...scope('runtime')]);
    j = { phase: 'started', input: started.description ?? started.task?.description ?? '' };
    save(t.id, j);
    console.log('started', t.id);
  }
  if (!j || j.phase === 'completed' && !j.paid) return;
  if (j.phase === 'starting' || j.phase.endsWith('-pending') && !j.paid) throw new Error(`Uncertain ${j.phase}; inspect before recovery`);

  if (j.paid || (j.phase === 'started' && PAID && registration())) {
    if (j.paid?.stage === 'settled') return;
    const cur: Journal = j;
    const r = await advancePaid(t.id, cur.input ?? '', cur.paid, (p) => save(t.id, { ...cur, paid: p }), async (input, deadline) => (await answer(t.id, input, deadline)).text);
    save(t.id, { ...cur, paid: r.paid, phase: r.completed ? 'completed' : cur.phase });
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
    const completion = cli(['runtime', 'complete', t.id, '--coworker-id', COWORKER_ID, ...scope('runtime'), '--result-file', join(dir, `${t.id}.txt`)]);
    save(t.id, { ...j, phase: 'completed', completion });
    console.log('completed', t.id);
  }
}

console.log(`coworker worker ${process.pid} for ${COWORKER_ID} (${PAID ? 'paid' : 'unpaid'} Tasks)`);
for (;;) {
  try {
    const { tasks } = cli<{ tasks: any[] }>(['tasks', 'list', '--coworker-id', COWORKER_ID, ...scope('task')]);
    for (const t of tasks.filter((x) => !x.coworkerId || x.coworkerId === COWORKER_ID)) {
      try {
        await step(t);
      } catch (e) {
        console.error('task blocked', t.id, String((e as Error).message).slice(0, 200));
      }
    }
  } catch (e) {
    console.error('poll failed', String((e as Error).message).slice(0, 200));
  }
  await new Promise((r) => setTimeout(r, 5000));
}
