'use client';
import { useState } from 'react';
import { api, operatorToken, useLive } from '@/product/api';
import { PageHead } from '@/product/ui';

type Health = { services: { name: string; url: string; ok: boolean; detail?: string }[]; chain: { ready: boolean; reason: string | null } };

const ACTIONS: { id: string; label: string; hint: string; path: string; body?: unknown; danger?: boolean }[] = [
  { id: 'reset', label: 'Reset demo', hint: 'Clears the ledger, tasks and receipts, resets every demo merchant. Keeps running hires.', path: '/api/demo/reset', danger: true },
  { id: 'find', label: 'Act 1: Find', hint: 'Scans the demo receipts and statement.', path: '/api/find/run', body: { mode: 'demo' } },
  { id: 'fix', label: 'Act 2: Fix all', hint: 'Starts the fleet on every open ledger line.', path: '/api/fix', body: { opportunityIds: 'all' } },
  { id: 'long', label: 'Start long-timer hire', hint: 'Start 65 to 70 minutes before the slot so the collection lands on stage.', path: '/api/hires', body: { longTimer: true } },
  { id: 'hire', label: 'Act 3: Fresh specialist hire', hint: 'Locks the fee over x402 and starts the specialist.', path: '/api/hires', body: { longTimer: false } },
  { id: 'bloc', label: 'Open a fresh bloc campaign', hint: 'Mints a campaign NFT for the eSIM bloc.', path: '/api/bloc/campaign', body: {} },
  { id: 'sim-on', label: 'Simulated pledgers on', hint: 'Labelled simulated pledges, batched from the treasury.', path: '/api/bloc/simulate', body: { on: true } },
  { id: 'sim-off', label: 'Simulated pledgers off', hint: '', path: '/api/bloc/simulate', body: { on: false } },
  { id: 'settle', label: 'Settle the bloc', hint: 'Best valid bid, settled in atomic batches of N_max.', path: '/api/bloc/settle', body: {} },
];

export default function Control() {
  const { data, reload } = useLive<Health>('/api/health/services', [], { services: [], chain: { ready: false, reason: null } });
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState(() => operatorToken() ?? '');
  const saveToken = (v: string) => {
    setToken(v);
    try {
      localStorage.setItem('overpaid.operator', v);
    } catch {}
  };

  const run = async (a: (typeof ACTIONS)[number]) => {
    setBusy(a.id);
    const t0 = performance.now();
    try {
      const r = await api(a.path, { method: 'POST', json: a.body ?? {} });
      setLog((l) => [`${new Date().toLocaleTimeString()} ${a.label}: ok in ${Math.round(performance.now() - t0)} ms ${JSON.stringify(r).slice(0, 160)}`, ...l]);
    } catch (e) {
      setLog((l) => [`${new Date().toLocaleTimeString()} ${a.label}: ${(e as Error).message}`, ...l]);
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <>
      <PageHead title="Demo control" sub="Hidden route for the stage. Everything here is logged." tone={data.chain.ready ? 'good' : 'warn'} />
      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="op-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {ACTIONS.map((a) => (
            <div key={a.id} className="op-card" style={{ display: 'grid', gap: 10, alignContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 17 }}>{a.label}</h2>
                <div className="card-sub">{a.hint}</div>
              </div>
              <div>
                <button className={`op-btn small ${a.danger ? 'danger' : 'lime'}`} onClick={() => run(a)} disabled={!!busy}>
                  {busy === a.id ? 'Running…' : 'Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="op-grid">
          <div className="op-card" style={{ display: 'grid', gap: 10 }}>
            <h2>Operator token</h2>
            <div className="card-sub">Needed for actions that spend Clawback&apos;s own preprod funds. Stored only in this browser.</div>
            <input
              type="password"
              value={token}
              onChange={(e) => saveToken(e.target.value)}
              placeholder="OPERATOR_TOKEN from .env"
              style={{ height: 44, borderRadius: 12, border: '1px solid var(--line)', padding: '0 14px', font: 'inherit' }}
            />
          </div>
          <div className="op-card">
            <div className="op-card-head">
              <h2>Services</h2>
              <button className="op-btn plain small" onClick={reload}>Refresh</button>
            </div>
            {data.services.map((s) => (
              <div key={s.name} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span className={`op-dot ${s.ok ? 'good' : 'bad'}`} />
                <b style={{ width: 120 }}>{s.name}</b>
                <span className="op-mono op-muted" style={{ flex: 1 }}>{s.url}</span>
                <span className="op-muted" style={{ fontSize: 12 }}>{s.detail ?? ''}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <span className={`op-dot ${data.chain.ready ? 'good' : 'warn'}`} />
              <b style={{ width: 120 }}>Cardano</b>
              <span className="op-muted">{data.chain.ready ? 'Preprod ready' : data.chain.reason}</span>
            </div>
          </div>
          <div className="op-card">
            <h2 style={{ marginBottom: 12 }}>Log</h2>
            <div className="op-mono" style={{ display: 'grid', gap: 6, maxHeight: 360, overflow: 'auto' }}>
              {log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <span className="op-muted">Nothing yet</span>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
