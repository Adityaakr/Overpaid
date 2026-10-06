'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowSquareOut, SealCheck, Timer, Warning } from '@phosphor-icons/react';
import { api, useLive } from '@/product/api';
import { PageHead } from '@/product/ui';

type Hire = {
  id: string;
  longTimer: boolean;
  escrowState: string;
  jobId: string | null;
  createdAt: string;
  payBy: string | null;
  submitResultBy: string | null;
  unlockAt: string | null;
  disputeUnlockAt: string | null;
  txLock: string | null;
  txResult: string | null;
  txCollect: string | null;
  txRefund: string | null;
  inputHash: string | null;
  resultHash: string | null;
  note: string | null;
};
type Spec = {
  specialist: {
    name: string;
    capability: string;
    fee: string;
    firstParty: boolean;
    url: string;
    registered: boolean;
    masumiAgentId: string | null;
    online: boolean;
    sellerAddress: string | null;
  } | null;
  chainReady: boolean;
  chainReason: string | null;
  hires: Hire[];
};

const CARDANOSCAN = 'https://preprod.cardanoscan.io/transaction/';
const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  quoted: { label: 'Quoted', tone: '' },
  FundsLocked: { label: 'Fee locked in escrow', tone: 'warn' },
  ResultSubmitted: { label: 'Result submitted', tone: 'warn' },
  Withdrawn: { label: 'Collected by specialist', tone: 'good' },
  RefundRequested: { label: 'Refund requested', tone: 'warn' },
  Disputed: { label: 'Disputed', tone: 'bad' },
  RefundAuthorized: { label: 'Refund authorised', tone: 'warn' },
  RefundWithdrawn: { label: 'Refunded to Overpaid', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
function rel(iso: string | null, now: number) {
  if (!iso) return '';
  const d = Math.round((new Date(iso).getTime() - now) / 1000);
  const a = Math.abs(d);
  const s = a >= 3600 ? `${Math.floor(a / 3600)}h ${Math.floor((a % 3600) / 60)}m` : a >= 60 ? `${Math.floor(a / 60)}m ${a % 60}s` : `${a}s`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}

export default function SpecialistPage() {
  const { data, reload } = useLive<Spec>('/api/specialist', ['escrow.updated', 'task.updated'], { specialist: null, chainReady: false, chainReason: null, hires: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow();

  const hire = async (longTimer: boolean) => {
    setBusy(longTimer ? 'long' : 'hire');
    setErr(null);
    try {
      await api('/api/hires', { method: 'POST', json: { longTimer } });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = data.specialist;
  return (
    <>
      <PageHead
        title="Specialist hires"
        tone={data.chainReady ? 'good' : 'warn'}
        sub={data.chainReady ? 'Escrow on Cardano preprod, paid over x402' : data.chainReason ?? 'Cardano preprod not configured'}
        actions={
          <>
            <button className="op-btn light" onClick={() => hire(true)} disabled={!data.chainReady || !!busy}>
              <span className="ico"><Timer size={20} /></span>
              {busy === 'long' ? 'Locking…' : 'Start long-timer hire'}
            </button>
            <button className="op-btn" onClick={() => hire(false)} disabled={!data.chainReady || !!busy}>
              <span className="ico"><ArrowRight size={20} /></span>
              {busy === 'hire' ? 'Paying over x402…' : 'Hire for the Skylane claim'}
            </button>
          </>
        }
      />
      {err ? <div className="op-banner" style={{ marginBottom: 20 }}><Warning size={18} />{err}</div> : null}

      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', alignItems: 'start' }}>
        <div className="op-card" style={{ display: 'grid', gap: 18 }}>
          <div className="op-card-head" style={{ marginBottom: 0 }}>
            <div>
              <h2>{s?.name ?? 'Airline compensation specialist'}</h2>
              <div className="card-sub">{s?.capability ?? 'Files delay compensation claims that generic agents get rejected on'}</div>
            </div>
            <span className={`op-pill ${s?.online ? 'good' : 'bad'}`}>{s?.online ? 'Online' : 'Offline'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s?.firstParty !== false ? <span className="op-pill dark">First-party specialist, built by the Overpaid team</span> : null}
            <span className="op-pill">{s?.registered ? 'Registered on Masumi preprod' : 'Not yet on the Masumi registry'}</span>
          </div>
          <Row k="Fee" v={s?.fee ?? '—'} />
          <Row k="Endpoint" v={s?.url ?? '—'} mono />
          <Row k="Seller wallet" v={s?.sellerAddress ?? '—'} mono />
          {s?.masumiAgentId ? <Row k="Masumi agent id" v={s.masumiAgentId} mono /> : null}
          <div className="op-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            The fee sits in Masumi’s escrow contract. It releases to the specialist after the unlock time unless Overpaid disputes first.
            Disputes go to Masumi’s admin multisig after the dispute unlock time. No protocol fee is taken by the contract.
          </div>
        </div>

        <div className="op-grid">
          {data.hires.length ? (
            data.hires.map((h) => <HireCard key={h.id} h={h} now={now} />)
          ) : (
            <div className="op-card op-empty">No hires yet. The flight delay claim needs a specialist; hire from here or from the fleet.</div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span className="op-label">{k}</span>
      <span className={mono ? 'op-mono' : undefined} style={{ wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

function HireCard({ h, now }: { h: Hire; now: number }) {
  const st = STATE_LABEL[h.escrowState] ?? { label: h.escrowState, tone: '' };
  const points = [
    { t: 'Locked', at: h.createdAt, done: !!h.txLock },
    { t: 'Pay by', at: h.payBy, done: !!h.txLock },
    { t: 'Submit result by', at: h.submitResultBy, done: !!h.txResult },
    { t: 'Unlock', at: h.unlockAt, done: !!h.txCollect },
    { t: 'Dispute unlock', at: h.disputeUnlockAt, done: false },
  ];
  const t0 = new Date(h.createdAt).getTime();
  const t1 = h.disputeUnlockAt ? new Date(h.disputeUnlockAt).getTime() : t0 + 1;
  const pct = Math.max(0, Math.min(1, (now - t0) / Math.max(1, t1 - t0)));
  return (
    <div className="op-card">
      <div className="op-card-head">
        <div>
          <h2 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {h.longTimer ? 'Long-timer hire' : 'Hire'} <span className="op-muted op-mono">{h.jobId ?? h.id}</span>
          </h2>
          <div className="card-sub">Started {fmt(h.createdAt)} · {rel(h.createdAt, now)}</div>
        </div>
        <span className={`op-pill ${st.tone}`}>{st.label}</span>
      </div>
      <div className="op-timeline">
        <div className="track" />
        <div className="fill" style={{ width: `${pct * 80}%` }} />
        {points.map((p) => {
          const passed = p.at ? new Date(p.at).getTime() <= now : false;
          return (
            <div key={p.t} className={`op-tl${p.done ? ' done' : passed ? ' now' : ''}`}>
              <span className="node" />
              <span className="t">{p.t}</span>
              <span className="d num">{fmt(p.at)}</span>
              <span className="d num" style={{ fontSize: 12 }}>{rel(p.at, now)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>
        <TxLink label="Lock" hash={h.txLock} />
        <TxLink label="Result" hash={h.txResult} />
        <TxLink label="Collect" hash={h.txCollect} />
        <TxLink label="Refund" hash={h.txRefund} />
      </div>
      {h.resultHash ? (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <SealCheck size={18} />
          <span className="op-label">Evidence hash</span>
          <span className="op-mono">{h.resultHash}</span>
        </div>
      ) : null}
      {h.note ? <div className="op-muted" style={{ marginTop: 10, fontSize: 13 }}>{h.note}</div> : null}
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: string | null }) {
  if (!hash) return <span className="op-pill ghost" style={{ opacity: 0.5 }}>{label}: pending</span>;
  return (
    <a className="op-pill" href={`${CARDANOSCAN}${hash}`} target="_blank" rel="noreferrer">
      {label} {hash.slice(0, 8)}… <ArrowSquareOut size={14} />
    </a>
  );
}
