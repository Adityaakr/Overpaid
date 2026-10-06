'use client';
import QRCode from 'react-qr-code';
import NumberFlow from '@number-flow/react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useLive } from '@/product/api';
import { PageHead } from '@/product/ui';

type Bloc = {
  campaign: {
    id: string;
    item: string;
    asset: string;
    unitLabel: string;
    membersLimit: number;
    minBatch: number;
    bidDeadline: string | null;
    refundDeadline: string | null;
    campaignTx: string | null;
    scriptAddress: string | null;
    state: string;
    marketPrice: number;
  } | null;
  joinUrl: string | null;
  nMax: number | null;
  pledges: { real: number; simulated: number; lockedTotal: number; recent: { id: string; label: string; simulated: boolean; txHash: string | null; at: string }[] };
  bids: { id: string; provider: string; unitPrice: number; strategy: string | null; valid: boolean; at: string }[];
  settlements: { id: string; txHash: string | null; pledgeCount: number; unitPrice: number }[];
  chainReady: boolean;
  chainReason: string | null;
};
const EMPTY: Bloc = { campaign: null, joinUrl: null, nMax: null, pledges: { real: 0, simulated: 0, lockedTotal: 0, recent: [] }, bids: [], settlements: [], chainReady: false, chainReason: null };
const SCAN = 'https://preprod.cardanoscan.io/transaction/';

export default function BlocRoom() {
  const { data } = useLive<Bloc>('/api/bloc', ['bloc.pledged', 'bloc.bid', 'bloc.settled'], EMPTY);
  const c = data.campaign;
  const best = [...data.bids].filter((b) => b.valid).sort((a, b) => a.unitPrice - b.unitPrice)[0];
  const fmtPrice = (v: number) => `${(v / 1_000_000).toFixed(2)} tADA`;
  // Providers re-bid as rivals move; show each provider's latest bid, best first.
  const latest = [...new Map([...data.bids].sort((a, b) => a.at.localeCompare(b.at)).map((b) => [b.provider, b])).values()].sort((a, b) => a.unitPrice - b.unitPrice);
  const saving = c && best ? ((c.marketPrice - best.unitPrice) / c.marketPrice) * 100 : 0;

  return (
    <>
      <PageHead
        title={c ? `${c.item} bloc` : 'Bloc room'}
        tone={data.chainReady ? 'good' : 'warn'}
        sub={
          c
            ? `${data.pledges.real} real and ${data.pledges.simulated} simulated pledges locked on chain`
            : data.chainReady
              ? 'No campaign yet. Open one from demo control.'
              : (data.chainReason ?? 'Cardano preprod not configured')
        }
      />
      <div className="op-grid" style={{ gridTemplateColumns: '360px minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="op-card" style={{ display: 'grid', gap: 18, justifyItems: 'center', textAlign: 'center' }}>
          <h2>Join from your phone</h2>
          {data.joinUrl ? (
            <div style={{ background: '#fff', padding: 12, borderRadius: 16 }}>
              <QRCode value={data.joinUrl} size={260} />
            </div>
          ) : (
            <div className="op-empty" style={{ height: 284, display: 'grid', placeItems: 'center' }}>QR appears when the join page has a public URL</div>
          )}
          <div className="op-muted" style={{ fontSize: 13 }}>
            You get a demo wallet funded by Overpaid and a real preprod pledge. Demo wallets are custodial and labelled.
          </div>
        </div>

        <div className="op-grid">
          <div className="op-card dark" style={{ display: 'grid', gap: 12 }}>
            <div className="card-sub">Pledged demand on chain</div>
            <div style={{ display: 'flex', gap: 28, alignItems: 'baseline' }}>
              <div>
                <div className="num" style={{ fontSize: 64, letterSpacing: '-0.05em', lineHeight: 1 }}>
                  <NumberFlow value={data.pledges.real} />
                </div>
                <div className="card-sub">real pledges</div>
              </div>
              <div>
                <div className="num" style={{ fontSize: 64, letterSpacing: '-0.05em', lineHeight: 1, color: 'rgba(255,255,255,0.55)' }}>
                  <NumberFlow value={data.pledges.simulated} />
                </div>
                <div className="card-sub">simulated, labelled</div>
              </div>
            </div>
          </div>
          <div className="op-card" style={{ display: 'grid', gap: 10 }}>
            <div className="op-card-head" style={{ marginBottom: 6 }}>
              <h2>Price</h2>
              {saving > 0 ? <span className="op-pill good num">−{saving.toFixed(1)}% vs today</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'baseline' }}>
              <div>
                <div className="op-label">Today</div>
                <div className="num" style={{ fontSize: 28 }}>{c ? fmtPrice(c.marketPrice) : '—'}</div>
              </div>
              <div>
                <div className="op-label">Best signed bid</div>
                <div className="num" style={{ fontSize: 28, color: 'var(--good)' }}>{best ? fmtPrice(best.unitPrice) : '—'}</div>
              </div>
            </div>
          </div>
          <div className="op-card">
            <h2 style={{ marginBottom: 12 }}>Pledges landing</h2>
            <div style={{ display: 'grid', gap: 8, maxHeight: 300, overflow: 'auto' }}>
              {data.pledges.recent.length ? (
                data.pledges.recent.map((p) => (
                  <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className={`op-pill ${p.simulated ? 'ghost' : 'lime'}`}>{p.simulated ? 'simulated' : 'real'}</span>
                    <span style={{ flex: 1 }}>{p.label}</span>
                    {p.txHash ? (
                      <a className="op-mono link" href={`${SCAN}${p.txHash}`} target="_blank" rel="noreferrer">{p.txHash.slice(0, 10)}…</a>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="op-empty">Waiting for the first pledge</div>
              )}
            </div>
          </div>
        </div>

        <div className="op-grid">
          <div className="op-card">
            <h2 style={{ marginBottom: 12 }}>Provider bids</h2>
            <div className="op-muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Fictional eSIM providers, simulated bidder agents. Bids are ed25519-signed. Prices per member{c ? `, ${c.unitLabel}` : ''}.
            </div>
            {latest.length ? (
              latest.map((b) => (
                <div key={b.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <b>{b.provider}</b>
                    <span className="num">{fmtPrice(b.unitPrice)}</span>
                  </div>
                  <div className="op-muted" style={{ fontSize: 13 }}>
                    {b.valid ? 'Signature valid' : 'Rejected'}{b.strategy ? ` · ${b.strategy}` : ''}
                  </div>
                </div>
              ))
            ) : (
              <div className="op-empty">No bids yet</div>
            )}
          </div>
          <div className="op-card">
            <h2 style={{ marginBottom: 6 }}>Settlement</h2>
            <div className="op-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              {data.nMax
                ? `Measured capacity: ${data.nMax} pledges per atomic transaction. Larger blocs settle in several transactions, each atomic, not jointly atomic.`
                : 'Capacity not measured yet.'}
            </div>
            {data.settlements.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span className="op-pill good num">{s.pledgeCount} pledges</span>
                <span className="num">{fmtPrice(s.unitPrice)}</span>
                {s.txHash ? (
                  <a className="op-pill" href={`${SCAN}${s.txHash}`} target="_blank" rel="noreferrer">
                    {s.txHash.slice(0, 10)}… <ArrowSquareOut size={14} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
