'use client';
import { useEffect, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import { api } from './api';

/** Plain-language brief of the current ledger, written by Claude from the ledger rows. */
export function LedgerBrief({ deps }: { deps: unknown }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let on = true;
    setLoading(true);
    api<{ text: string | null }>('/api/ledger/brief')
      .then((r) => on && setText(r.text))
      .catch(() => on && setText(null))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [deps]);
  if (!loading && !text) return null;
  return (
    <div className="op-card" style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
      <div className="op-card-head" style={{ marginBottom: 0 }}>
        <div>
          <h2><Sparkle size={18} style={{ verticalAlign: -3 }} /> In plain words</h2>
          <div className="card-sub">Written by Claude from the ledger rows. The numbers are the engine’s; the words are the model’s.</div>
        </div>
      </div>
      {loading && !text ? <div className="op-muted">Reading your ledger…</div> : null}
      {text ? (
        <div style={{ display: 'grid', gap: 6, fontSize: 15, lineHeight: 1.55 }}>
          {text.split('\n').filter((l) => l.trim()).map((l, i) => (l.trim().startsWith('-') || l.trim().startsWith('•') ? <div key={i} style={{ paddingLeft: 14 }}>• {l.replace(/^\s*[-•]\s*/, '')}</div> : <p key={i}>{l}</p>))}
        </div>
      ) : null}
    </div>
  );
}

/** Draft-a-message button for one ledger line; the draft is stored on the line once written. */
export function DraftButton({ id, initial }: { id: string; initial?: string | null }) {
  const [draft, setDraft] = useState<string | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setDraft((await api<{ draft: string }>(`/api/opportunities/${id}/draft`, { method: 'POST', json: {} })).draft);
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+\s*/, ''));
    } finally {
      setBusy(false);
    }
  };
  if (!draft)
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="op-btn small light" onClick={go} disabled={busy}><Sparkle size={14} /> {busy ? 'Drafting…' : 'Draft the message'}</button>
        {err ? <span className="op-muted" style={{ fontSize: 13 }}>{err}</span> : null}
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 6, background: 'var(--canvas)', borderRadius: 12, padding: '10px 12px', fontSize: 14, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b>Message to send</b>
        <button className="op-btn small plain" onClick={() => (void navigator.clipboard.writeText(draft), setCopied(true), setTimeout(() => setCopied(false), 1500))}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{draft}</div>
    </div>
  );
}
