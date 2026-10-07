'use client';
import { useState } from 'react';
import { ArrowSquareOut, Anchor as AnchorIcon, SealCheck } from '@phosphor-icons/react';
import { buildSignSubmit, errText, SCAN, useWallet } from './wallet';

export type Anchor = { txHash: string; hash: string; at: string; payer: string; summary: { lines: number; atStakeCents: number; researched: number } };

/** One user-signed transaction that puts the hash of this review on Cardano. No custody, no fee to Clawback. */
export function AnchorCard({ anchor, digest, onDone }: { anchor: Anchor | null; digest: string; onDone?: () => void }) {
  const w = useWallet();
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = anchor && anchor.hash === digest;
  const go = async () => {
    setErr(null);
    try {
      await buildSignSubmit(w, { build: '/api/anchor/build', submit: '/api/anchor/submit', onStage: setStage, submitBody: {} , buildBody: {} });
      onDone?.();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStage(null);
    }
  };
  return (
    <div className="op-card" style={{ display: 'grid', gap: 10 }}>
      <div className="op-card-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>{current ? 'Anchored on Cardano' : 'Anchor this review'}</h2>
          <div className="card-sub">
            {current
              ? `Signed by you on ${new Date(anchor.at).toLocaleDateString()}: ${anchor.summary.lines} lines, ${anchor.summary.researched} with agent evidence.`
              : anchor
                ? 'The review changed since your last anchor. Sign again to put the new hash on chain.'
                : 'Sign one small transaction from your own wallet that carries the hash of every line and evidence bundle. 1.5 tADA goes back to you; only the network fee is spent.'}
          </div>
        </div>
        {current ? (
          <a className="op-btn small light" href={`${SCAN}/transaction/${anchor.txHash}`} target="_blank" rel="noreferrer">
            <SealCheck size={16} /> {anchor.txHash.slice(0, 8)}… <ArrowSquareOut size={14} />
          </a>
        ) : (
          <button className="op-btn small lime" onClick={go} disabled={Boolean(stage)}>
            <AnchorIcon size={16} /> {stage === 'building' ? 'Building…' : stage === 'signing' ? 'Sign in your wallet…' : stage === 'submitting' ? 'Submitting…' : w.address ? 'Sign and anchor' : 'Connect a wallet to anchor'}
          </button>
        )}
      </div>
      <code className="op-mono op-muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>sha256 {digest}</code>
      {err ? <div className="op-banner">{err}</div> : null}
    </div>
  );
}
