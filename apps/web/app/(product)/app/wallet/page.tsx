'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { api } from '@/product/api';
import { PageHead } from '@/product/ui';
import { ConnectButton, errText, FAUCET, fmtAda, SCAN, useWallet, WalletDiagnostics } from '@/product/wallet';

type Chain = {
  pledges: { label: string; txHash: string | null; state: string; lockedLovelace: number; refundTxHash: string | null; settlementTxHash: string | null }[];
  fees: { receiptId: string; merchant: string; lovelace: number; txHash: string | null; at: string }[];
  hires: unknown[];
};
const EMPTY: Chain = { pledges: [], fees: [], hires: [] };

function Tx({ hash }: { hash: string | null | undefined }) {
  if (!hash) return <>—</>;
  return (
    <a className="op-mono link" href={`${SCAN}/transaction/${hash}`} target="_blank" rel="noreferrer" title={hash}>
      {hash.slice(0, 10)}… <ArrowSquareOut size={12} style={{ verticalAlign: -1 }} />
    </a>
  );
}

export default function WalletPage() {
  const w = useWallet();
  const [chain, setChain] = useState<Chain>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!w.address) return;
    setLoading(true);
    api<Chain>(`/api/me/chain?address=${encodeURIComponent(w.address)}`)
      .then((d) => {
        setChain({ pledges: d.pledges ?? [], fees: d.fees ?? [], hires: d.hires ?? [] });
        setErr(null);
      })
      .catch((e) => setErr(errText(e)))
      .finally(() => setLoading(false));
  }, [w.address]);
  useEffect(load, [load]);

  return (
    <>
      <PageHead
        title="My wallet"
        tone={w.address ? 'good' : w.wrongNetwork ? 'warn' : undefined}
        sub={w.address ? `${w.walletName} on Cardano preprod` : w.wrongNetwork ? 'Switch your wallet to Preprod' : 'Connect your own Cardano wallet. Clawback never sees your recovery phrase.'}
        actions={
          w.address ? (
            <>
              <button className="op-btn plain small" onClick={() => { void w.refresh(); load(); }}>Refresh</button>
              <button className="op-btn plain small" onClick={w.disconnect}>Disconnect</button>
            </>
          ) : null
        }
      />
      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <div className="op-grid">
          <div className="op-card" style={{ display: 'grid', gap: 14 }}>
            <h2>Wallet</h2>
            <ConnectButton />
            <WalletDiagnostics />
            {w.address ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="op-label">Address</div>
                <a className="op-mono link" style={{ wordBreak: 'break-all' }} href={`${SCAN}/address/${w.address}`} target="_blank" rel="noreferrer">
                  {w.address} <ArrowSquareOut size={12} style={{ verticalAlign: -1 }} />
                </a>
              </div>
            ) : null}
          </div>

          {w.address ? (
            <>
              {err ? <div className="op-banner">{err}</div> : null}
              <div className="op-card">
                <div className="op-card-head">
                  <h2>Bloc pledges</h2>
                  {loading ? <span className="op-pill ghost">Loading…</span> : null}
                </div>
                {chain.pledges.length ? (
                  <table className="op-table">
                    <thead>
                      <tr>
                        <th>Pledge</th>
                        <th>State</th>
                        <th>Pledge tx</th>
                        <th>Settled / refunded</th>
                        <th style={{ textAlign: 'right' }}>Locked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chain.pledges.map((p, i) => (
                        <tr key={p.txHash ?? i}>
                          <td><b>{p.label}</b></td>
                          <td><span className={`op-pill ${p.state === 'refunded' || p.state === 'settled' ? 'good' : ''}`}>{p.state}</span></td>
                          <td><Tx hash={p.txHash} /></td>
                          <td><Tx hash={p.settlementTxHash ?? p.refundTxHash} /></td>
                          <td className="num" style={{ textAlign: 'right' }}>{fmtAda(p.lockedLovelace)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="op-empty">No pledges from this wallet yet.</div>
                )}
              </div>
              <div className="op-card">
                <h2 style={{ marginBottom: 12 }}>Success fees paid</h2>
                {chain.fees.length ? (
                  <table className="op-table">
                    <thead>
                      <tr>
                        <th>Merchant</th>
                        <th>When</th>
                        <th>Tx</th>
                        <th style={{ textAlign: 'right' }}>Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chain.fees.map((f) => (
                        <tr key={f.receiptId}>
                          <td><b>{f.merchant}</b></td>
                          <td>{new Date(f.at).toLocaleString()}</td>
                          <td><Tx hash={f.txHash} /></td>
                          <td className="num" style={{ textAlign: 'right' }}>{fmtAda(f.lovelace)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="op-empty">No fees paid from this wallet.</div>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="op-grid">
          <div className="op-card dark" style={{ display: 'grid', gap: 8 }}>
            <div className="card-sub">Balance</div>
            <div className="num" style={{ fontSize: 44, letterSpacing: '-0.04em', color: 'var(--lime)' }}>{w.address ? fmtAda(w.balanceLovelace) : '—'}</div>
            <div className="card-sub">Preprod test ADA. No real money.</div>
          </div>
          <div className="op-card" style={{ display: 'grid', gap: 10 }}>
            <h2>Need test ADA?</h2>
            <div className="op-muted" style={{ fontSize: 14 }}>The Cardano faucet sends free tADA to any preprod address. Pick Preprod and paste your address.</div>
            <a className="op-btn plain" href={FAUCET} target="_blank" rel="noreferrer" style={{ justifySelf: 'start', background: 'var(--canvas)' }}>
              Open the faucet <ArrowSquareOut size={16} />
            </a>
          </div>
          <div className="op-card" style={{ display: 'grid', gap: 8 }}>
            <h2>How signing works</h2>
            <div className="op-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
              Clawback’s server builds each transaction without any keys. Your wallet shows it to you and signs it. The server only attaches your signature and submits it.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
