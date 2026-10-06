'use client';
import { SealCheck } from '@phosphor-icons/react';
import { API, useLive } from '@/product/api';
import { Money, PageHead } from '@/product/ui';
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
};

export default function Receipts() {
  const { data } = useLive<Receipt[]>('/api/receipts', ['money.recovered', 'task.updated'], []);
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
        <div className="op-card dark" style={{ display: 'grid', gap: 8 }}>
          <div className="card-sub">Total recovered</div>
          <div className="num" style={{ fontSize: 44, letterSpacing: '-0.04em', color: 'var(--lime)' }}>
            <Money cents={total} />
          </div>
          <div className="card-sub">Evidence bundles are SHA-256 hashes of RFC 8785 canonical JSON. Where money moved on chain, the hash is on chain too.</div>
        </div>
      </div>
    </>
  );
}
