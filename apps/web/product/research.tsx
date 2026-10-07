'use client';
import { useState } from 'react';
import { ArrowSquareOut, Browsers, SealCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from './api';

export type Research = { site?: string | null; cancelUrl?: string | null; pricingUrl?: string | null; supportUrl?: string | null; prices?: string | null; howTo?: string | null; notes?: string | null; summary?: string; taskId?: string; at?: string };

/** What a research agent found on the merchant's own site, with the evidence bundle. */
export function ResearchResult({ r }: { r: Research }) {
  const links = [
    ['Official site', r.site],
    ['How to cancel or claim', r.cancelUrl],
    ['Pricing', r.pricingUrl],
    ['Support', r.supportUrl],
  ].filter((x): x is [string, string] => typeof x[1] === 'string' && /^https?:/.test(x[1]));
  // Some sites block automated browsers; the agent says so instead of guessing, and the card says so too.
  const found = links.length > 0 || Boolean(r.howTo) || Boolean(r.prices);
  return (
    <div style={{ display: 'grid', gap: 8, background: found ? 'var(--good-bg)' : 'var(--surface-2, rgba(0,0,0,0.04))', borderRadius: 12, padding: '10px 12px', fontSize: 14, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b><SealCheck size={15} style={{ verticalAlign: -2 }} /> {found ? "An agent checked the merchant's site" : "An agent tried the merchant's site but couldn't verify it"}</b>
        {r.taskId ? <Link className="link" href={`/app/evidence/${r.taskId}`} style={{ fontSize: 13 }}>what the agent saw <ArrowSquareOut size={12} /></Link> : null}
      </div>
      {r.howTo ? <div>{r.howTo}</div> : null}
      {r.prices ? <div><b>Prices:</b> {r.prices}</div> : null}
      {r.notes ? <div className="op-muted" style={{ fontSize: 13 }}>{r.notes}</div> : null}
      {!r.howTo && !r.prices && r.summary ? <div>{r.summary.slice(0, 400)}</div> : null}
      {links.length ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {links.map(([label, href]) => (
            <a key={label} className="op-pill good" href={href} target="_blank" rel="noreferrer">{label} <ArrowSquareOut size={12} /></a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Sends a browser agent to the merchant's own site for one line. */
export function SendAgentButton({ id, status, onSent }: { id: string; status: string; onSent?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (status === 'queued' || status === 'in_progress') return <span className="op-pill warn"><Browsers size={14} /> Agent on the site</span>;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/fix', { method: 'POST', json: { opportunityIds: [id] } });
      onSent?.();
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+\s*/, ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button className="op-btn small light" onClick={go} disabled={busy}><Browsers size={14} /> {busy ? 'Sending…' : 'Send an agent'}</button>
      {err ? <span className="op-muted" style={{ fontSize: 12 }}>{err}</span> : null}
    </span>
  );
}
