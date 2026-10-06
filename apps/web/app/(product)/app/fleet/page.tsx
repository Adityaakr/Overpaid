'use client';
import { useState } from 'react';
import { Check, X, ShieldWarning } from '@phosphor-icons/react';
import { api, useLive } from '@/product/api';
import { Money, PageHead } from '@/product/ui';
import { VIGIL } from '@/product/vigils';

type FleetTask = {
  id: string;
  state: string;
  step: string | null;
  mode: 'agent' | 'scripted';
  merchant: string;
  vigilType: string;
  valueEstimate: number;
  recoveredCents: number | null;
  confirmationCode: string | null;
  evidenceSha256: string | null;
  failureReason: string | null;
  streamUrl: string | null;
  frameUrl: string | null;
  flagged: string | null;
  bySpecialist: boolean;
};
type Approval = { id: string; taskId: string; merchant: string; step: string; reason: string; screenshotUrl: string | null };
type Fleet = { tasks: FleetTask[]; recoveredCents: number; provider: string; model: string | null };

const STATE: Record<string, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: '' },
  running: { label: 'Working', tone: 'warn' },
  needs_approval: { label: 'Needs you', tone: 'lime' },
  needs_specialist: { label: 'Needs a specialist', tone: 'warn' },
  hired: { label: 'Specialist hired', tone: 'warn' },
  done: { label: 'Recovered', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  refunded: { label: 'Refunded', tone: '' },
  disputed: { label: 'Disputed', tone: 'bad' },
};

export default function FleetPage() {
  const { data } = useLive<Fleet>('/api/tasks', ['task.updated', 'money.recovered', 'approval.requested'], { tasks: [], recoveredCents: 0, provider: 'local', model: null });
  const { data: approvals, reload } = useLive<Approval[]>('/api/approvals?state=pending', ['approval.requested', 'task.updated'], []);
  const live = data.tasks.filter((t) => t.state === 'running' || t.state === 'needs_approval').length;
  const done = data.tasks.filter((t) => t.state === 'done').length;

  return (
    <>
      <PageHead
        title="Agent fleet"
        tone={approvals.length ? 'warn' : live ? 'good' : undefined}
        sub={
          data.tasks.length
            ? `${live} browsers live, ${done} of ${data.tasks.length} done${approvals.length ? `, ${approvals.length} waiting for you` : ''}`
            : 'No tasks yet. Approve fixes from the ledger.'
        }
        actions={
          <span className="op-pill ghost">
            {data.provider === 'agentcore' ? 'Amazon Bedrock AgentCore Browser' : 'Local Chromium (fallback)'}
            {data.model ? ` · ${data.model}` : ' · scripted mode'}
          </span>
        }
      />

      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <div className="op-fleet">
          {data.tasks.map((t) => (
            <Tile key={t.id} t={t} />
          ))}
          {Array.from({ length: Math.max(0, 8 - data.tasks.length) }).map((_, i) => (
            <div className="op-tile" key={`empty-${i}`} style={{ opacity: 0.5 }}>
              <div className="screen">
                <div className="idle">Idle browser</div>
              </div>
              <div className="meta">
                <div className="step">Waiting for a task</div>
              </div>
            </div>
          ))}
        </div>

        <div className="op-grid" style={{ position: 'sticky', top: 24 }}>
          <div className="op-card dark" style={{ display: 'grid', gap: 8 }}>
            <div className="card-sub">Recovered</div>
            <div className="num" style={{ fontSize: 48, letterSpacing: '-0.04em', color: 'var(--lime)' }}>
              <Money cents={data.recoveredCents} />
            </div>
            <div className="card-sub num">
              {done} confirmed on the demo merchants’ status pages
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Approvals</h2>
            <span className="op-muted" style={{ fontSize: 13 }}>Irreversible steps wait for you</span>
          </div>
          {approvals.length ? approvals.map((a) => <ApprovalCard key={a.id} a={a} onDone={reload} />) : <div className="op-card op-empty">Nothing waiting</div>}
        </div>
      </div>
    </>
  );
}

function Tile({ t }: { t: FleetTask }) {
  const v = VIGIL[t.vigilType];
  const s = STATE[t.state] ?? { label: t.state, tone: '' };
  const showStream = t.streamUrl && (t.state === 'running' || t.state === 'needs_approval');
  return (
    <div className="op-tile" style={t.state === 'needs_approval' ? { outline: '3px solid var(--lime)' } : undefined}>
      <div className="screen">
        <div className="tags">
          <span className={`op-pill ${s.tone}`}>{s.label}</span>
          <span className="op-pill">{t.bySpecialist ? 'specialist' : t.mode}</span>
        </div>
        {showStream ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.streamUrl!} alt={`Live browser for ${t.merchant}`} />
        ) : t.frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.frameUrl} alt={`Last frame for ${t.merchant}`} style={{ filter: t.state === 'done' ? 'saturate(0.6)' : undefined }} />
        ) : (
          <div className="idle">{t.state === 'queued' ? 'Starting browser…' : 'No frame'}</div>
        )}
      </div>
      <div className="meta">
        <div className="top">
          <span className="m">{t.merchant}</span>
          <span className={`amt num${t.state === 'done' ? '' : ' op-muted'}`} style={t.state === 'done' ? { color: 'var(--good)' } : undefined}>
            <Money cents={t.recoveredCents ?? t.valueEstimate} />
          </span>
        </div>
        <div className="step" title={t.failureReason ?? t.step ?? ''}>
          {t.flagged ? (
            <span style={{ color: 'var(--bad)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <ShieldWarning size={14} /> Ignored a page instruction
            </span>
          ) : t.state === 'done' && t.confirmationCode ? (
            `${v?.label ?? ''} · ${t.confirmationCode}`
          ) : (
            t.failureReason ?? t.step ?? v?.label
          )}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ a, onDone }: { a: Approval; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const decide = async (approved: boolean) => {
    setBusy(true);
    try {
      await api(`/api/approvals/${a.id}`, { method: 'POST', json: { approved } });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="op-approval">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>{a.merchant}</b>
        <span className="op-pill lime">Needs you</span>
      </div>
      {a.screenshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="shot" src={a.screenshotUrl} alt="What the agent sees" />
      ) : null}
      <div style={{ fontWeight: 500 }}>{a.step}</div>
      <div className="op-muted" style={{ fontSize: 14 }}>{a.reason}</div>
      <div className="btns">
        <button className="op-btn lime small" onClick={() => decide(true)} disabled={busy}>
          <Check size={16} /> Approve
        </button>
        <button className="op-btn danger small" onClick={() => decide(false)} disabled={busy}>
          <X size={16} /> Stop
        </button>
      </div>
    </div>
  );
}
