'use client';
import { useState } from 'react';
import { ArrowSquareOut, SealCheck } from '@phosphor-icons/react';
import { API, useLive } from '@/product/api';
import { Money, PageHead } from '@/product/ui';
import { buildSignSubmit, ConnectButton, errText, fmtAda, SCAN, useWallet } from '@/product/wallet';
import { VIGIL } from '@/product/vigils';

type Receipt = {
  id: string;
  merchant: string;
  vigilType: string;
  amount: number;
  currency: string;
  confirmedAt: string;
  confirmation: string | null;
  mode: string;
  evidenceSha256: string | null;
  evidenceUrl: string | null;
  demoMerchant: boolean;
  fee?: Fee | null;
};
type Fee = { state: 'unpaid' | 'paid'; lovelace: number; txHash: string | null; label: string };

export default function Receipts() {
  const { data, reload } = useLive<Receipt[]>('/api/receipts', ['money.recovered', 'task.updated'], []);
  const w = useWallet();
  const [paying, setPaying] = useState<string | null>(null);
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const payFee = async (r: Receipt) => {
    setPaying(r.id);
    setErr(null);
    try {
      const { result } = await buildSignSubmit<{ txCbor: string; feeLovelace: number; payTo: string }, { txHash: string; txUrl?: string }>(w, {
        build: `/api/fees/${encodeURIComponent(r.id)}/build`,
        submit: `/api/fees/${encodeURIComponent(r.id)}/submit`,
      });
      setPaid((p) => ({ ...p, [r.id]: result.txHash }));
      reload();
    } catch (e) {
      setErr(`${r.merchant}: ${errText(e)}`);
    } finally {
      setPaying(null);
    }
  };
  const total = data.reduce((s, r) => s + r.amount, 0);
  return (
    <>
      <PageHead title="Receipts" sub={`${data.length} recoveries, each confirmed on the merchant’s own status page`} tone={data.length ? 'good' : undefined} />
      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start' }}>
        <div className="op-card">
          {data.length ? (
            <table className="op-table">
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>What</th>
                  <th>Confirmation</th>
                  <th>Evidence</th>
                  <th>Success fee</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.merchant}</b>
                      {r.demoMerchant ? <div className="op-muted" style={{ fontSize: 12 }}>Demo merchant</div> : null}
                    </td>
                    <td>
                      {VIGIL[r.vigilType]?.label ?? r.vigilType}
                      <div className="op-muted" style={{ fontSize: 12 }}>{r.mode === 'scripted' ? 'Scripted run' : 'Agent run'} · {new Date(r.confirmedAt).toLocaleString()}</div>
                    </td>
                    <td className="op-mono">{r.confirmation ?? '—'}</td>
                    <td>
                      {r.evidenceSha256 ? (
                        <a className="link op-mono" href={`${API}${r.evidenceUrl}`} target="_blank" rel="noreferrer" title={r.evidenceSha256}>
                          <SealCheck size={14} style={{ verticalAlign: -2 }} /> {r.evidenceSha256.slice(0, 12)}…
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <FeeCell r={r} paidTx={paid[r.id]} busy={paying === r.id} disabled={!!paying} canPay={!!w.address} onPay={() => payFee(r)} />
                    </td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--good)' }}>
                      <Money cents={r.amount} currency={r.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="op-empty">Nothing recovered yet.</div>
          )}
        </div>
        <div className="op-grid">
          <div className="op-card dark" style={{ display: 'grid', gap: 8 }}>
            <div className="card-sub">Total recovered</div>
            <div className="num" style={{ fontSize: 44, letterSpacing: '-0.04em', color: 'var(--lime)' }}>
              <Money cents={total} />
            </div>
            <div className="card-sub">Evidence bundles are SHA-256 hashes of RFC 8785 canonical JSON. Only specialist results are anchored on chain; other recoveries keep their hash here.</div>
          </div>
          <div className="op-card" style={{ display: 'grid', gap: 12 }}>
            <div>
              <h2>Success fees</h2>
              <div className="card-sub">Paid in tADA on Cardano preprod from your own wallet, only for confirmed recoveries.</div>
            </div>
            <ConnectButton compact />
            {err ? <div className="op-banner">{err}</div> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function FeeCell({ r, paidTx, busy, disabled, canPay, onPay }: { r: Receipt; paidTx?: string; busy: boolean; disabled: boolean; canPay: boolean; onPay: () => void }) {
  const f = r.fee;
  if (!f) return <>—</>;
  const tx = f.txHash ?? paidTx ?? null;
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <span className="num">{fmtAda(f.lovelace)}</span>
      <span className="op-muted" style={{ fontSize: 12 }}>{r.demoMerchant ? 'test fee on a demo recovery' : f.label}</span>
      {f.state === 'paid' || tx ? (
        tx ? (
          <a className="op-pill good" href={`${SCAN}/transaction/${tx}`} target="_blank" rel="noreferrer">
            Paid {tx.slice(0, 8)}… <ArrowSquareOut size={14} />
          </a>
        ) : (
          <span className="op-pill good">Paid</span>
        )
      ) : canPay ? (
        <button className="op-btn small" onClick={onPay} disabled={disabled}>
          {busy ? 'Waiting for wallet…' : 'Pay fee from my wallet'}
        </button>
      ) : (
        <span className="op-pill ghost">Unpaid · connect a wallet</span>
      )}
    </div>
  );
}
