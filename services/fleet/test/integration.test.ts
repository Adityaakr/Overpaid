import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPECTED_FIX_TASKS, PORTS, hashEvidence, sha256Hex, type MerchantKey } from '@overpaid/shared';
import { REPO_ROOT, loadConfig } from '../src/config.js';
import { buildFleet, type FleetApp } from '../src/server.js';
import type { TaskView } from '../src/tasks.js';

// End to end: real merchant sites (isolated copy: ports +2000, own schema, short status delays) and the fleet's HTTP
// API, every recipe in scripted mode with auto-approval, verified from the merchants' status pages. Three runs.
const OFFSET = 2000;
const MERCHANTS_DIR = path.join(REPO_ROOT, 'services', 'merchants');
const SITES: MerchantKey[] = ['vistaflix', 'cartwell', 'skylane', 'parcelo'];
const origin = (k: MerchantKey) => `http://localhost:${PORTS[k] + OFFSET}`;
const COOKIE = { cookie: 'demo_session=alex-demo' };

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port }, () => (s.end(), resolve(true)));
    s.on('error', () => resolve(false));
    s.setTimeout(1500, () => (s.destroy(), resolve(false)));
  });
}

async function waitHealthy(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const ok = await Promise.all(SITES.map((k) => fetch(`${origin(k)}/healthz`).then((r) => r.ok).catch(() => false)));
    if (ok.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function taskInputs(run: number) {
  return EXPECTED_FIX_TASKS.map((t, i) => {
    const taskId = `it-r${run}-${i}-${t.ref}`;
    switch (t.vigil) {
      case 'forgotten_subscription':
        return { taskId, recipeId: 'vistaflix-cancel', params: { planId: t.ref } };
      case 'duplicate_charge':
        return { taskId, recipeId: 'cartwell-duplicate', params: { orderId: t.ref } };
      case 'price_drop':
        return { taskId, recipeId: 'cartwell-price-adjust', params: { orderId: t.ref } };
      case 'undelivered_order':
        return { taskId, recipeId: 'parcelo-undelivered', params: { orderId: t.ref } };
      case 'flight_compensation':
        return { taskId, recipeId: 'skylane-claim', params: { bookingRef: t.ref } };
    }
  });
}

describe('fleet end to end (scripted, every recipe, 3 runs)', () => {
  let skipReason: string | null = null;
  let merchants: ChildProcess | null = null;
  let fleet: FleetApp | null = null;
  let base = '';
  let evidenceDir = '';
  const rejectTasks = new Set<string>();
  const holdTasks = new Set<string>();
  const approvalsSeen: { taskId: string; step: string; screenshotUrl: string }[] = [];
  const flagged: string[] = [];
  let sseAbort: AbortController | null = null;

  beforeAll(async () => {
    if (!fs.existsSync(path.join(MERCHANTS_DIR, 'src', 'main.ts'))) {
      skipReason = 'services/merchants is not present';
      return;
    }
    const db = new URL(process.env.DATABASE_URL ?? 'postgres://localhost:5432/overpaid');
    if (!(await canConnect(db.hostname, Number(db.port || 5432)))) {
      skipReason = `Postgres is not reachable at ${db.hostname}:${db.port || 5432} (the merchants need it; run infra/docker-compose)`;
      return;
    }
    merchants = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: MERCHANTS_DIR,
      env: {
        ...process.env,
        MERCHANTS_PORT_OFFSET: String(OFFSET),
        MERCHANTS_SCHEMA: 'merchants_fleet_it',
        CARTWELL_RESOLVE_DELAY_SECONDS: '2',
        SKYLANE_PAID_DELAY_SECONDS: '3',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    merchants.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    if (!(await waitHealthy(45_000))) {
      skipReason = `merchants did not become healthy on ports ${PORTS.vistaflix + OFFSET}-${PORTS.parcelo + OFFSET}: ${stderr.slice(-500)}`;
      return;
    }
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-evidence-'));
    const cfg = loadConfig({ ...process.env, MERCHANTS_PORT_OFFSET: String(OFFSET), EVIDENCE_DIR: evidenceDir, FLEET_MODEL_CLIENT: 'none', FLEET_PROVIDER: 'local' });
    fleet = await buildFleet(cfg);
    await fleet.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(fleet.app.server.address() as AddressInfo).port}`;

    // Auto-approver driven by the SSE stream, exactly as the orchestrator would consume it.
    sseAbort = new AbortController();
    const res = await fetch(`${base}/events`, { signal: sseAbort.signal });
    const reader = res.body!.getReader();
    void (async () => {
      let buf = '';
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (!ev || !data) continue;
            const d = JSON.parse(data) as { taskId: string; step: string; screenshotUrl: string; approvalId: string; text: string };
            if (ev === 'approval.requested') {
              approvalsSeen.push(d);
              if (holdTasks.has(d.taskId)) continue;
              await fetch(`${base}/tasks/${d.taskId}/approval`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ approved: !rejectTasks.has(d.taskId), approvalId: d.approvalId }),
              });
            }
            if (ev === 'task.flagged') flagged.push(d.text);
          }
        }
      } catch {
        /* aborted */
      }
    })();
  }, 120_000);

  afterAll(async () => {
    sseAbort?.abort();
    await fleet?.close();
    merchants?.kill('SIGTERM');
    if (evidenceDir) fs.rmSync(evidenceDir, { recursive: true, force: true });
  });

  const post = (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const resetAll = async () => {
    for (const k of SITES) expect((await fetch(`${origin(k)}/reset`, { method: 'POST' })).ok).toBe(true);
  };
  async function waitTerminal(ids: string[], timeoutMs = 150_000): Promise<TaskView[]> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const all = (await (await fetch(`${base}/tasks`)).json()) as TaskView[];
      const mine = ids.map((id) => all.find((t) => t.taskId === id)!);
      if (mine.every((t) => t && (t.state === 'done' || t.state === 'failed'))) return mine;
      if (Date.now() > end) throw new Error(`timeout: ${mine.map((t) => `${t.taskId}=${t.state}/${t.step}`).join(', ')}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  for (const run of [1, 2, 3]) {
    it(`run ${run}: all ${EXPECTED_FIX_TASKS.length} demo tasks complete and verify`, async (ctx) => {
      if (skipReason) {
        console.warn(`[fleet integration] SKIPPED: ${skipReason}`);
        ctx.skip();
      }
      await resetAll();
      const inputs = taskInputs(run);
      for (const input of inputs) {
        const r = await post('/tasks', { ...input, mode: 'auto' });
        expect(r.status, await r.clone().text()).toBe(202);
      }
      // Idempotent on taskId.
      const again = await post('/tasks', inputs[0]);
      expect(again.status).toBe(200);
      expect(((await again.json()) as TaskView).taskId).toBe(inputs[0]!.taskId);

      const tasks = await waitTerminal(inputs.map((i) => i.taskId));
      for (const t of tasks) {
        expect(t.state, `${t.taskId}: ${t.failureReason}`).toBe('done');
        expect(t.mode).toBe('scripted');
        expect(t.modeReason).toMatch(/no model credentials/);
        expect(t.confirmationCode, t.taskId).toBeTruthy();
        expect(t.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);

        // Evidence: canonical manifest on disk hashes to the reported sha; every screenshot hash matches its file.
        const dir = path.join(evidenceDir, t.taskId);
        const text = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(text);
        expect(sha256Hex(text)).toBe(t.evidenceSha256);
        expect(hashEvidence(manifest)).toBe(t.evidenceSha256);
        expect(manifest.confirmation_code).toBe(t.confirmationCode);
        expect(manifest.outcome).toBe(`verified: ${t.verifiedStatus}`);
        const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
        const hashes = new Set(pngs.map((f) => sha256Hex(fs.readFileSync(path.join(dir, f)))));
        for (const s of manifest.steps) if (s.screenshot_sha256) expect(hashes.has(s.screenshot_sha256)).toBe(true);
        expect(manifest.steps.some((s: { action: string }) => s.action.startsWith('approval granted'))).toBe(true);

        // Independent check of the merchant status page (not the fleet's or the script's claim).
        const recipe = fleet!.recipes.get(t.recipeId)!;
        expect([...recipe.successSignal.successValues, ...recipe.successSignal.finalValues]).toContain(t.verifiedStatus);
        const statusPath = new URL(recipe.successSignal.statusUrl.replace('{{origin}}', origin(recipe.merchant)).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String((t.params as Record<string, string>)[k] ?? (k === 'orderId' ? 'CW-4417' : 'SKX7Q2'))));
        const html = await (await fetch(statusPath, { headers: COOKIE })).text();
        expect(html, `${t.taskId} status page`).toContain(t.confirmationCode!);
        if (!recipe.successSignal.followLink) expect(html).toContain(`data-status="${t.verifiedStatus}"`);
      }
      // Every task paused for exactly one approval with a screenshot.
      for (const t of tasks) {
        const a = approvalsSeen.filter((x) => x.taskId === t.taskId);
        expect(a).toHaveLength(1);
        const img = await fetch(`${base}${a[0]!.screenshotUrl}`);
        expect(img.headers.get('content-type')).toBe('image/png');
      }
      // Parcelo pages carry a prompt-injection note aimed at agents: it must be flagged, never followed.
      const parcelo = tasks.filter((t) => t.merchant === 'parcelo');
      expect(parcelo.every((t) => t.state === 'done')).toBe(true);
      expect(parcelo.some((t) => t.flags.some((f) => /AI agents/i.test(f.text)))).toBe(true);
      expect(flagged.some((f) => /AI agents/i.test(f))).toBe(true);
    }, 200_000);
  }

  it('a rejected approval fails the task and leaves the merchant unchanged', async (ctx) => {
    if (skipReason) {
      console.warn(`[fleet integration] SKIPPED: ${skipReason}`);
      ctx.skip();
    }
    await resetAll();
    rejectTasks.add('it-reject');
    expect((await post('/tasks', { taskId: 'it-reject', recipeId: 'vistaflix-cancel', params: { planId: 'vf-plan-premium' }, mode: 'scripted' })).status).toBe(202);
    const [t] = await waitTerminal(['it-reject']);
    expect(t!.state).toBe('failed');
    expect(t!.failureReason).toMatch(/rejected/);
    expect(t!.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    const html = await (await fetch(`${origin('vistaflix')}/account`, { headers: COOKIE })).text();
    expect(html).toMatch(/data-testid="plan-row-vf-plan-premium"[^>]*data-status="active"/);
    // Live view: latest frame as JPEG, and the MJPEG multipart stream.
    const frame = await fetch(`${base}/tasks/it-reject/frame.jpg`);
    expect(frame.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await frame.arrayBuffer()).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const ac = new AbortController();
    const stream = await fetch(`${base}/tasks/it-reject/stream`, { signal: ac.signal });
    expect(stream.headers.get('content-type')).toContain('multipart/x-mixed-replace');
    const first = await stream.body!.getReader().read();
    expect(Buffer.from(first.value!).toString('latin1')).toContain('--overpaidframe');
    ac.abort();
    // Health reports the provider and that there is no model client.
    const h = (await (await fetch(`${base}/healthz`)).json()) as { provider: string; defaultMode: string; holdsKeys: boolean };
    expect(h).toMatchObject({ provider: 'local', defaultMode: 'scripted', holdsKeys: false });
  }, 120_000);

  it('cancel while waiting for approval fails the task without performing the step', async (ctx) => {
    if (skipReason) {
      console.warn(`[fleet integration] SKIPPED: ${skipReason}`);
      ctx.skip();
    }
    await resetAll();
    holdTasks.add('it-cancel');
    expect((await post('/tasks', { taskId: 'it-cancel', recipeId: 'parcelo-undelivered', params: { orderId: 'PM-88213' } })).status).toBe(202);
    const end = Date.now() + 60_000;
    let t: TaskView;
    do {
      await new Promise((r) => setTimeout(r, 300));
      t = (await (await fetch(`${base}/tasks/it-cancel`)).json()) as TaskView;
    } while (t.state !== 'needs_approval' && Date.now() < end);
    expect(t.pendingApproval?.step).toBe('Submit non-delivery claim');
    expect((await post('/tasks/it-cancel/approval', { approved: true, approvalId: 'wrong' })).status).toBe(409);
    expect((await post('/tasks/it-cancel/cancel', {})).status).toBe(200);
    const [done] = await waitTerminal(['it-cancel']);
    expect(done!.state).toBe('failed');
    expect(done!.failureReason).toMatch(/cancelled/);
    const html = await (await fetch(`${origin('parcelo')}/orders/PM-88213`, { headers: COOKIE })).text();
    expect(html).not.toContain('data-status="refund_approved"');
  }, 120_000);
});
