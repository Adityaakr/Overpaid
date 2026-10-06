'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CaretDown } from '@phosphor-icons/react';
import { VIGIL } from '@/product/vigils';
import { api, useLive } from '@/product/api';
import { Money, PageHead } from '@/product/ui';

type Item = {
  id: string;
  vigilType: string;
  merchant: string;
  valueEstimate: number;
  currency: string;
  confidence: number;
  reason: string;
  status: string;
  sources: { id: string; label: string }[];
  meta?: Record<string, unknown>;
};
type Ledger = {
  total: number;
  currency: string;
  count: number;
  ranAt: string | null;
  durationMs: number | null;
  demo: boolean;
  sourceCounts: { emails: number; statements: number; transactions: number };
  items: Item[];
};
const EMPTY: Ledger = { total: 0, currency: 'USD', count: 0, ranAt: null, durationMs: null, demo: true, sourceCounts: { emails: 0, statements: 0, transactions: 0 }, items: [] };



const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Found', tone: '' },
  queued: { label: 'Queued', tone: 'warn' },
  in_progress: { label: 'Agent working', tone: 'warn' },
  recovered: { label: 'Recovered', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  dismissed: { label: 'Dismissed', tone: '' },
};

export default function MoneyOnTheTable() {
  const { data, reload } = useLive<Ledger>('/api/ledger', ['money.found', 'money.recovered', 'task.updated'], EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const runDemo = async () => {
    setBusy('find');
    try {
      await api('/api/find/run', { method: 'POST', json: { mode: 'demo' } });
      reload();
    } finally {
      setBusy(null);
    }
  };
  const fixAll = async () => {
    setBusy('fix');
    try {
      await api('/api/fix', { method: 'POST', json: { opportunityIds: 'all' } });
      window.location.href = '/app/fleet';
    } finally {
      setBusy(null);
    }
  };

  const fixable = data.items.filter((i) => i.status === 'open' && i.vigilType !== 'bill_above_market').length;
  const working = data.items.filter((i) => i.status === 'in_progress' || i.status === 'queued').length;

  if (!data.count) {
    return (
      <>
        <PageHead title="Money on the table" sub="Nothing scanned yet" />
        <div className="op-card" style={{ padding: 48, display: 'grid', gap: 20, justifyItems: 'start' }}>
          <h2 style={{ fontSize: 28 }}>Find what you’re owed in under a minute.</h2>
          <p className="op-muted" style={{ maxWidth: 560, fontSize: 16 }}>
            Drop in your receipts and a card statement, or use the demo account. Overpaid builds one ledger and shows every overcharge with
            its reason and the records it came from.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="op-btn" onClick={runDemo} disabled={busy === 'find'}>
              <span className="ico"><ArrowRight size={20} /></span>
              {busy === 'find' ? 'Scanning demo data…' : 'Use demo data'}
            </button>
            <Link className="op-btn light" href="/app/connect">
              <span className="ico"><ArrowRight size={20} /></span>
              Upload my exports
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Money on the table"
        tone={working ? 'warn' : 'good'}
        sub={working ? `${working} agents working, ${fixable} waiting for you` : `${data.count} leaks found, ${fixable} ready to fix`}
        actions={
          <button className="op-btn" onClick={fixAll} disabled={!fixable || busy === 'fix'}>
            <span className="ico"><ArrowRight size={20} /></span>
            {busy === 'fix' ? 'Starting agents…' : `Approve and fix ${fixable}`}
          </button>
        }
      />

      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', marginBottom: 20 }}>
        <div className="op-card" style={{ display: 'grid', alignContent: 'space-between', gap: 28 }}>
          <div className="op-card-head" style={{ marginBottom: 0 }}>
            <div>
              <h2>Owed to you</h2>
              <div className="card-sub">
                {data.demo ? 'Demo account, synthetic receipts' : 'Your exports, processed locally'}
              </div>
            </div>
            <span className="op-pill dark num">{data.durationMs != null ? `found in ${(data.durationMs / 1000).toFixed(1)} s` : ''}</span>
          </div>
          <div className="op-big num">
            <Money cents={data.total} currency={data.currency} />
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Stat k="Receipts read" v={data.sourceCounts.emails} />
            <Stat k="Statements" v={data.sourceCounts.statements} />
            <Stat k="Transactions" v={data.sourceCounts.transactions} />
            <Stat k="Leaks" v={data.count} />
          </div>
        </div>
        <div className="op-card">
          <div className="op-card-head">
            <div>
              <h2>Where it leaked</h2>
              <div className="card-sub">By type</div>
            </div>
          </div>
          <Breakdown items={data.items} total={data.total} />
        </div>
      </div>

      <div className="op-card">
        <div className="op-card-head">
          <div>
            <h2>Ledger</h2>
            <div className="card-sub">Every line shows the reason and the records it came from</div>
          </div>
        </div>
        <div className="op-ledger">
          {data.items.map((it) => {
            const v = VIGIL[it.vigilType] ?? VIGIL.duplicate_charge!;
            const s = STATUS[it.status] ?? STATUS.open!;
            const Icon = v.icon;
            const isOpen = open === it.id;
            return (
              <div key={it.id}>
                <div className="op-row">
                  <div className="icon" style={{ background: v.tint }}>
                    <Icon size={22} />
                  </div>
                  <div>
                    <div className="merchant">{it.merchant}</div>
                    <div className="vigil">{v.label} · {Math.round(it.confidence * 100)}% sure</div>
                  </div>
                  <div className="reason">
                    {it.reason}{' '}
                    <button
                      onClick={() => setOpen(isOpen ? null : it.id)}
                      style={{ border: 0, background: 'none', color: 'var(--ink-50)', cursor: 'pointer', font: 'inherit', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 2 }}
                      aria-expanded={isOpen}
                    >
                      {it.sources.length} source{it.sources.length === 1 ? '' : 's'} <CaretDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
                    </button>
                  </div>
                  <div className="value num">
                    <Money cents={it.valueEstimate} currency={it.currency} />
                    {String(it.meta?.valueBasis ?? '').startsWith('annual') ? (
                      <div className="op-muted" style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0 }}>saved per year</div>
                    ) : it.vigilType === 'bill_above_market' ? (
                      <div className="op-muted" style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0 }}>per year, as a bloc</div>
                    ) : null}
                  </div>
                  <div className="status">
                    <span className={`op-pill ${s.tone}`}>{it.vigilType === 'bill_above_market' && it.status === 'open' ? 'Join a bloc' : s.label}</span>
                  </div>
                </div>
                {isOpen ? (
                  <div className="op-sources" style={{ display: 'flex', padding: '0 4px 16px 64px' }}>
                    {it.sources.map((s) => (
                      <span key={s.id} className="op-src">{s.label}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <div className="op-label">{k}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em' }}>{v}</div>
    </div>
  );
}

function Breakdown({ items, total }: { items: Item[]; total: number }) {
  const by = new Map<string, number>();
  for (const i of items) by.set(i.vigilType, (by.get(i.vigilType) ?? 0) + i.valueEstimate);
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', gap: 6, height: 14, borderRadius: 99, overflow: 'hidden', background: 'var(--canvas)', padding: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ flex: v, background: VIGIL[k]?.tint, borderRadius: 99 }} />
        ))}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: VIGIL[k]?.tint }} />
          <span style={{ flex: 1, color: 'var(--ink-75)' }}>{VIGIL[k]?.label ?? k}</span>
          <span className="op-muted num" style={{ width: 48, textAlign: 'right' }}>{total ? Math.round((v / total) * 100) : 0}%</span>
          <span className="num" style={{ width: 96, textAlign: 'right', fontWeight: 500 }}>
            <Money cents={v} />
          </span>
        </div>
      ))}
    </div>
  );
}
