'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react';
import { api } from '@/product/api';
import { Logo } from '@/product/ui';
import { ConnectButton, useWallet } from '@/product/wallet';
import { PledgeFromWallet } from '@/product/pledge';

type Joined = { label: string; txHash: string | null; wallet: string; lockedLabel: string; state: string };

function Join() {
  const token = useSearchParams().get('t') ?? '';
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Joined | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [refundDeadline, setRefundDeadline] = useState<string | null>(null);
  const w = useWallet();
  useEffect(() => {
    api<{ campaign: { refundDeadline: string | null } | null }>('/api/bloc')
      .then((b) => setRefundDeadline(b.campaign?.refundDeadline ?? null))
      .catch(() => {});
  }, []);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      setDone(await api<Joined>('/api/bloc/join', { method: 'POST', json: { token, nickname: name.trim() } }));
    } catch (e) {
      setErr((e as Error).message.replace(/^\d+\s*/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100svh', padding: '28px 20px', display: 'grid', alignContent: 'start', gap: 24, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 18 }}>
        <Logo size={28} /> Clawback
      </div>
      <div>
        <h1 style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: '-0.04em', fontWeight: 500 }}>Bargain as a group.</h1>
        <p className="op-muted" style={{ marginTop: 10, fontSize: 16 }}>
          Join the eSIM bloc. Your pledge is locked on Cardano preprod. Providers bid for everyone at once, and you get the difference back.
        </p>
      </div>
      {!demo ? (
        <>
          <div className="op-card" style={{ display: 'grid', gap: 16 }}>
            <div>
              <h2>Pledge from your own wallet</h2>
              <div className="card-sub">Lace, Eternl or any CIP-30 wallet on Cardano Preprod. Clawback builds the transaction; only your wallet signs it.</div>
            </div>
            <ConnectButton />
            {w.address ? <PledgeFromWallet refundDeadline={refundDeadline} cta="Join the eSIM bloc" /> : null}
          </div>
          <button className="link" onClick={() => setDemo(true)} style={{ fontSize: 14, justifySelf: 'start', color: 'var(--ink-75)' }}>
            No wallet? Use a demo wallet (custodial, run by Clawback)
          </button>
        </>
      ) : done ? (
        <div className="op-card" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--good)', fontWeight: 600 }}>
            <CheckCircle size={24} weight="fill" /> You’re in, {done.label}
          </div>
          <div className="op-muted">Pledged {done.lockedLabel} from a custodial demo wallet funded and held by Clawback.</div>
          <div className="op-mono" style={{ wordBreak: 'break-all' }}>{done.wallet}</div>
          {done.txHash ? (
            <a className="op-btn plain" href={`https://preprod.cardanoscan.io/transaction/${done.txHash}`} target="_blank" rel="noreferrer">
              View your pledge on chain <ArrowSquareOut size={16} />
            </a>
          ) : (
            <div className="op-pill warn">Submitting to preprod…</div>
          )}
        </div>
      ) : (
        <div className="op-card" style={{ display: 'grid', gap: 14 }}>
          <div className="op-pill warn" style={{ justifySelf: 'start' }}>Custodial demo wallet</div>
          <div className="op-muted" style={{ fontSize: 14 }}>Clawback creates and holds a demo wallet for you and pledges from it. You do not control its keys.</div>
          <label className="op-label" htmlFor="nick">Nickname shown on the projector</label>
          <input
            id="nick"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya"
            style={{ height: 52, borderRadius: 14, border: '1px solid var(--line)', padding: '0 16px', font: 'inherit', fontSize: 17 }}
          />
          <button className="op-btn" onClick={join} disabled={busy || !name.trim() || !token}>
            <span className="ico"><ArrowRight size={20} /></span>
            {busy ? 'Locking your pledge…' : 'Join the eSIM bloc'}
          </button>
          {!token ? <div className="op-banner">Scan the QR code on the projector to get a join link.</div> : null}
          {err ? <div className="op-banner">{err}</div> : null}
          <button className="link" onClick={() => setDemo(false)} style={{ fontSize: 14, justifySelf: 'start' }}>
            Back to pledging from my own wallet
          </button>
        </div>
      )}
      <p className="op-muted" style={{ fontSize: 12 }}>
        Preprod test network only. No real money. Pledges from your own wallet stay refundable to that wallet. The optional demo wallet is custodial and run by Clawback for this event.
      </p>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}
