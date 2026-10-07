'use client';
import { useState } from 'react';
import { ArrowCounterClockwise, CalendarCheck, CheckCircle, Handshake, HourglassHigh, Prohibit, SealCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { api, useLive } from '@/product/api';
import { Money, PageHead } from '@/product/ui';
import { VIGIL } from '@/product/vigils';
import { LedgerBrief } from '@/product/brief';

type Item = {
  id: string; merchant: string; vigilType: string; valueEstimate: number; currency: string; status: string; reason: string;
  action: string | null; valueBasis: string | null; selfServe: boolean; decision: string | null; task: string | null; new: boolean;
};
type Review = {
  since: string; nextReviewAt: string; recoveredWeekCents: number; recoveredTotalCents: number;
  recovered: { id: string; merchant: string; amount: number; currency: string; confirmedAt: string; mode: string }[];
  awaiting: { id: string; taskId: string; step: string; reason: string; createdAt: string }[];
  decide: Item[]; kept: Item[]; removed: Item[]; working: Item[];
};
const EMPTY: Review = { since: '', nextReviewAt: '', recoveredWeekCents: 0, recoveredTotalCents: 0, recovered: [], awaiting: [], decide: [], kept: [], removed: [], working: [] };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

export default function SundayReview() {
  const { data, reload } = useLive<Review>('/api/review', ['money.found', 'money.recovered', 'task.updated', 'approval.requested'], EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, decision: 'keep' | 'remove' | 'undo') => {
    setBusy(id);
    try {
      await api(`/api/opportunities/${id}/decide`, { method: 'POST', json: { decision } });
      reload();
    } finally {
      setBusy(null);
    }
  };
  const approve = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await api(`/api/approvals/${id}`, { method: 'POST', json: { approved } });
      reload();
    } finally {
      setBusy(null);
    }
  };
  const toDecide = data.decide.length + data.awaiting.length;

  return (
    <>
      <PageHead
        title="Sunday review"
        tone={toDecide ? 'warn' : 'good'}
        sub={toDecide ? `${toDecide} decision${toDecide === 1 ? '' : 's'} waiting for you. Everything else ran on its own.` : 'Nothing waiting for you. The agents keep running.'}
        actions={
          <span className="op-pill dark" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <CalendarCheck size={16} /> Next review {data.nextReviewAt ? day(data.nextReviewAt) : '…'}
          </span>
        }
      />

      <div className="op-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 20 }}>
        <div className="op-card dark" style={{ display: 'grid', gap: 6 }}>
          <div className="card-sub">Recovered this week</div>
          <div className="num" style={{ fontSize: 40, letterSpacing: '-0.04em', color: 'var(--lime)' }}><Money cents={data.recoveredWeekCents} /></div>
          <div className="card-sub"><Money cents={data.recoveredTotalCents} /> since you connected. Success fee applies only to this.</div>
        </div>
        <div className="op-card" style={{ display: 'grid', gap: 6 }}>
          <div className="card-sub">Agents working now</div>
          <div className="num" style={{ fontSize: 40, letterSpacing: '-0.04em' }}>{data.working.length}</div>
          <div className="card-sub">Nothing irreversible happens without your approval.</div>
        </div>
        <div className="op-card" style={{ display: 'grid', gap: 6 }}>
          <div className="card-sub">Lines you kept</div>
          <div className="num" style={{ fontSize: 40, letterSpacing: '-0.04em' }}>{data.kept.length}</div>
          <div className="card-sub">Left alone until you change your mind.</div>
        </div>
      </div>

      <LedgerBrief deps={data.decide.length} />

      {data.awaiting.length ? (
        <div className="op-card" style={{ marginBottom: 20 }}>
          <div className="op-card-head">
            <div>
              <h2>Waiting for your approval</h2>
              <div className="card-sub">An agent reached an irreversible step and stopped.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {data.awaiting.map((a) => (
              <div key={a.id} className="op-approval" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <b>{a.step}</b>
                  <div className="op-muted" style={{ fontSize: 13 }}>{a.reason}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="op-btn small lime" disabled={busy === a.id} onClick={() => approve(a.id, true)}><CheckCircle size={16} /> Approve</button>
                  <button className="op-btn small light" disabled={busy === a.id} onClick={() => approve(a.id, false)}><Prohibit size={16} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="op-card">
          <div className="op-card-head">
            <div>
              <h2>Keep or remove</h2>
              <div className="card-sub">Found on your accounts. Keep means leave it alone; remove means act on it and stop showing it.</div>
            </div>
            <Link href="/app" className="link" style={{ fontSize: 14 }}>Full ledger</Link>
          </div>
          {data.decide.length === 0 ? <div className="op-empty">Nothing new to decide.</div> : null}
          <div className="op-ledger">
            {data.decide.map((it) => {
              const v = VIGIL[it.vigilType] ?? VIGIL.duplicate_charge!;
              const Icon = v.icon;
              return (
                <div key={it.id} className="op-row" style={{ gridTemplateColumns: '44px minmax(0,1fr) auto auto' }}>
                  <div className="icon" style={{ background: v.tint }}><Icon size={22} /></div>
                  <div>
                    <div className="merchant">{it.merchant} {it.new ? <span className="op-pill lime" style={{ marginLeft: 6 }}>new</span> : null}</div>
                    <div className="vigil">{v.label}</div>
                    <div className="op-muted" style={{ fontSize: 13, marginTop: 4 }}>{it.action ?? it.reason}</div>
                  </div>
                  <div className="value num">
                    <Money cents={it.valueEstimate} currency={it.currency} />
                    <div className="op-muted" style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0 }}>{it.valueBasis === 'annual' ? 'per year' : 'one-off'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="op-btn small light" disabled={busy === it.id} onClick={() => decide(it.id, 'keep')}>Keep</button>
                    <button className="op-btn small" disabled={busy === it.id} onClick={() => decide(it.id, 'remove')}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 20 }}>
          <div className="op-card">
            <div className="op-card-head" style={{ marginBottom: 12 }}>
              <div>
                <h2>Recovered this week</h2>
                <div className="card-sub">Confirmed on the merchant's own status page.</div>
              </div>
            </div>
            {data.recovered.length === 0 ? <div className="op-empty">Nothing confirmed in the last seven days.</div> : null}
            <div style={{ display: 'grid', gap: 8 }}>
              {data.recovered.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span><SealCheck size={14} style={{ verticalAlign: -2, color: 'var(--good)' }} /> {r.merchant}</span>
                  <span className="num" style={{ color: 'var(--good)', fontWeight: 600 }}><Money cents={r.amount} currency={r.currency} /></span>
                </div>
              ))}
            </div>
          </div>
          <div className="op-card">
            <div className="op-card-head" style={{ marginBottom: 12 }}>
              <div>
                <h2>Still working</h2>
                <div className="card-sub">Agents on it, specialists in escrow.</div>
              </div>
            </div>
            {data.working.length === 0 ? <div className="op-empty">No agent runs in progress.</div> : null}
            <div style={{ display: 'grid', gap: 8 }}>
              {data.working.map((it) => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                  <span>{it.task === 'needs_specialist' || it.task === 'hired' ? <Handshake size={14} style={{ verticalAlign: -2 }} /> : <HourglassHigh size={14} style={{ verticalAlign: -2 }} />} {it.merchant}</span>
                  <span className="op-muted">{it.task?.replace('_', ' ') ?? it.status}</span>
                </div>
              ))}
            </div>
          </div>
          {data.kept.length || data.removed.length ? (
            <div className="op-card">
              <div className="op-card-head" style={{ marginBottom: 12 }}>
                <div>
                  <h2>Your earlier decisions</h2>
                  <div className="card-sub">Change your mind any Sunday.</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[...data.kept, ...data.removed].map((it) => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, alignItems: 'center' }}>
                    <span>{it.merchant} <span className="op-pill ghost" style={{ marginLeft: 6 }}>{it.decision === 'keep' ? 'kept' : 'removed'}</span></span>
                    <button className="op-btn small plain" disabled={busy === it.id} onClick={() => decide(it.id, 'undo')}><ArrowCounterClockwise size={14} /> Undo</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
