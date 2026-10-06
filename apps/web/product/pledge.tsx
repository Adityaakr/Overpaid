'use client';
import { useState } from 'react';
import { ArrowRight, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react';
import { buildSignSubmit, errText, fmtAda, SCAN, useWallet } from './wallet';

type PledgeBuilt = { txCbor: string; lockedLovelace: number; refundAddress: string };
type PledgeSubmitted = { txHash: string; txUrl?: string; label: string };
type Stage = 'building' | 'signing' | 'submitting';
const STAGE: Record<Stage, string> = {
  building: 'Building your pledge…',
  signing: 'Approve it in your wallet…',
  submitting: 'Submitting to preprod…',
};

export const fmtDeadline = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : 'the refund deadline');

/** Nickname -> build -> sign in the user's wallet -> submit. Shows the success card when done. */
export function PledgeFromWallet({ refundDeadline, cta = 'Pledge from my wallet', onDone }: { refundDeadline?: string | null; cta?: string; onDone?: () => void }) {
  const w = useWallet();
  const [name, setName] = useState('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<(PledgeSubmitted & { lockedLovelace: number; refundAddress: string }) | null>(null);

  const pledge = async () => {
    setErr(null);
    try {
      const { built, result } = await buildSignSubmit<PledgeBuilt, PledgeSubmitted>(w, {
        build: '/api/bloc/pledge/build',
        submit: '/api/bloc/pledge/submit',
        submitBody: { nickname: name.trim() },
        onStage: setStage,
      });
      setDone({ ...result, lockedLovelace: built.lockedLovelace, refundAddress: built.refundAddress });
      onDone?.();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStage(null);
    }
  };

  if (done) {
    return (
      <div style={{ display: 'grid', gap: 12, textAlign: 'left' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--good)', fontWeight: 600 }}>
          <CheckCircle size={24} weight="fill" /> You’re in, {done.label}
        </div>
        <div className="op-muted">
          {fmtAda(done.lockedLovelace)} locked from your own wallet. Your pledge is locked in the bloc contract. If no deal settles, you can refund it to your own wallet after{' '}
          {fmtDeadline(refundDeadline)}.
        </div>
        <a className="op-btn plain" href={done.txUrl ?? `${SCAN}/transaction/${done.txHash}`} target="_blank" rel="noreferrer" style={{ justifySelf: 'start' }}>
          View your pledge on CardanoScan <ArrowSquareOut size={16} />
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12, textAlign: 'left' }}>
      <label className="op-label" htmlFor="pledge-nick">Nickname shown on the projector</label>
      <input
        id="pledge-nick"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Priya"
        style={{ height: 52, borderRadius: 14, border: '1px solid var(--line)', padding: '0 16px', font: 'inherit', fontSize: 17 }}
      />
      <button className="op-btn" onClick={pledge} disabled={!!stage || !name.trim() || !w.address}>
        <span className="ico"><ArrowRight size={20} /></span>
        {stage ? STAGE[stage] : cta}
      </button>
      {err ? <div className="op-banner">{err}</div> : null}
    </div>
  );
}
