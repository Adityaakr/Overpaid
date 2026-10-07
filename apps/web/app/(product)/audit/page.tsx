'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowSquareOut, FileArrowUp, LockKey, SealCheck } from '@phosphor-icons/react';
import { API, api } from '@/product/api';
import { Logo } from '@/product/ui';
import { ConnectButton, errText, fmtAda, SCAN, useWallet } from '@/product/wallet';

type Preview = { ok: boolean; rows: number; months: number; count: number; totalCents: number; currency: string; types: string[]; priceLovelace: string };
type Paid = { report: string; findings: number; totalCents: number; paymentTx: string };
type Stage = 'idle' | 'quote' | 'build' | 'sign' | 'verify';

const STAGE: Record<Stage, string> = {
  idle: '',
  quote: 'Asking for the price (HTTP 402)…',
  build: 'Preparing the payment…',
  sign: 'Approve the payment in your wallet…',
  verify: 'Verifying the payment on Cardano and running the audit…',
};
const CLAIM_KEY = 'overpaid.auditClaim';
const store = { get: () => { try { return localStorage.getItem(CLAIM_KEY); } catch { return null; } }, set: (v: string | null) => { try { v ? localStorage.setItem(CLAIM_KEY, v) : localStorage.removeItem(CLAIM_KEY); } catch {} } };
async function fetchClaim(claim: string): Promise<Paid | null> {
  const r = await fetch(`${API}/api/x402/audit/claim/${claim}`).catch(() => null);
  return r?.ok ? ((await r.json()) as Paid) : null;
}
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const b64json = (s: string) => JSON.parse(atob(s));

// Minimal markdown for the report: headings, bullets, bold, horizontal rules.
function Report({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  return (
    <div style={{ display: 'grid', gap: 8, fontSize: 15, lineHeight: 1.55 }}>
      {text.split('\n').map((l, i) =>
        l.startsWith('# ') ? <h2 key={i} style={{ fontSize: 24, marginTop: 4 }}>{l.slice(2)}</h2>
        : l.startsWith('## ') ? <h3 key={i} style={{ fontSize: 18, marginTop: 14 }}>{inline(l.slice(3))}</h3>
        : l.startsWith('- ') ? <div key={i} className="op-mono" style={{ fontSize: 13, paddingLeft: 12, color: 'var(--ink-75)' }}>{l.slice(2)}</div>
        : l === '---' ? <hr key={i} style={{ border: 0, borderTop: '1px solid var(--line, #e5e5e5)', margin: '10px 0' }} />
        : l.trim() ? <p key={i}>{inline(l)}</p>
        : null,
      )}
    </div>
  );
}

export default function Audit() {
  const w = useWallet();
  const [statement, setStatement] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A paid audit whose response was lost (closed tab, dropped connection) comes back from its claim id.
  useEffect(() => {
    const claim = store.get();
    if (claim) void fetchClaim(claim).then((p) => p && setPaid(p));
  }, []);

  const loadSample = async () => setStatement(await (await fetch('/sample-statement.csv')).text());
  const loadFile = async (f: File | undefined) => f && setStatement(await f.text());

  const check = async () => {
    setErr(null);
    setPaid(null);
    setBusy(true);
    try {
      setPreview(await api<Preview>('/api/audit/preview', { method: 'POST', json: { statement } }));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // The x402 flow, as any client would run it: 402 -> pay -> retry with the payment header.
  const pay = async () => {
    setErr(null);
    setBusy(true);
    try {
      setStage('quote');
      const url = `${API}/api/x402/audit`;
      const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statement }) });
      if (first.status !== 402) throw new Error(`expected a 402 price, got ${first.status}`);
      const required = b64json(first.headers.get('payment-required') ?? '');
      const accepted = required.accepts[0];
      setStage('build');
      const built = await api<{ buildId: string; txCbor: string; nonce: string }>('/api/x402/pay/build', { method: 'POST', json: { address: w.address, requirements: accepted } });
      setStage('sign');
      const witnessSet = await w.signTx(built.txCbor, true);
      const { transaction } = await api<{ transaction: string }>('/api/x402/pay/assemble', { method: 'POST', json: { buildId: built.buildId, witnessSet } });
      setStage('verify');
      const claim = crypto.randomUUID().replace(/-/g, '');
      store.set(claim);
      const header = btoa(JSON.stringify({ x402Version: 2, resource: required.resource, accepted, payload: { transaction, nonce: built.nonce } }));
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header, 'x-audit-claim': claim }, body: JSON.stringify({ statement }) }).catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      if (res?.ok && body) {
        setPaid(body as Paid);
      } else if (res && res.status < 500 && body) {
        store.set(null);
        throw new Error(body.error ?? body.invalidMessage ?? `payment was not accepted (${res.status})`);
      } else {
        // The response was lost: if the payment settled, the result is waiting under our claim id.
        let found: Paid | null = null;
        for (let i = 0; i < 24 && !found; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          found = await fetchClaim(claim);
        }
        if (!found) throw new Error('No answer from the server. If your wallet shows the payment, reload this page to fetch your audit.');
        setPaid(found);
      }
      void w.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStage('idle');
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100svh', padding: '28px 20px 60px', display: 'grid', alignContent: 'start', gap: 22, maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 18 }}>
          <Logo size={28} /> Overpaid
        </a>
        <a className="link" href="/app" style={{ fontSize: 14 }}>
          Open the full app
        </a>
      </div>
      <div>
        <h1 style={{ fontSize: 40, lineHeight: 1.08, letterSpacing: '-0.04em', fontWeight: 500 }}>Find the money your card statement is hiding.</h1>
        <p className="op-muted" style={{ marginTop: 10, fontSize: 17 }}>
          Forgotten subscriptions, duplicate charges, bills above market. See how much for free; unlock the full audit and ready-to-send messages for {fmtAda(2_000_000, 0)}, paid per request with x402 from your own wallet. No account.
        </p>
      </div>

      {!paid ? (
        <div className="op-card" style={{ display: 'grid', gap: 14 }}>
          <div>
            <h2>1. Your statement</h2>
            <div className="card-sub">CSV with Date, Description and Amount columns, ideally three months or more. It is read in memory to compute the audit, not stored.</div>
          </div>
          <textarea
            value={statement}
            onChange={(e) => (setStatement(e.target.value), setPreview(null))}
            placeholder={'Date,Description,Amount,Currency\n2026-04-12,TUNEWAVE*PREMIUM,10.99,USD\n…'}
            rows={9}
            className="op-mono"
            style={{ width: '100%', fontSize: 13, padding: 12, borderRadius: 12, border: '1px solid var(--line, #ddd)', background: 'var(--paper, #fff)', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="op-btn" onClick={check} disabled={busy || statement.trim().length < 20}>
              Check for free
            </button>
            <label className="op-btn light" style={{ cursor: 'pointer' }}>
              <span className="ico"><FileArrowUp size={18} /></span> Upload CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
            </label>
            <button className="link" onClick={loadSample} style={{ fontSize: 14 }}>
              Use a sample statement
            </button>
          </div>
        </div>
      ) : null}

      {preview && !paid ? (
        <div className="op-card" style={{ display: 'grid', gap: 14 }}>
          {preview.ok ? (
            <>
              <div>
                <h2>2. What we found</h2>
                <div className="card-sub">
                  {preview.rows} transactions over {preview.months} month{preview.months === 1 ? '' : 's'}.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span className="num" style={{ fontSize: 44, letterSpacing: '-0.04em', color: 'var(--good)' }}>{money(preview.totalCents)}</span>
                <span className="op-muted">in {preview.count} item{preview.count === 1 ? '' : 's'}: {preview.types.join(', ').toLowerCase() || 'nothing to recover'}</span>
              </div>
              {preview.count ? (
                <>
                  <div className="card-sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <LockKey size={16} /> The full audit lists each merchant with its source rows and a message to send. Pay {fmtAda(Number(preview.priceLovelace), 0)} on Cardano preprod to unlock it.
                  </div>
                  <ConnectButton />
                  {w.address ? (
                    <button className="op-btn" onClick={pay} disabled={busy} style={{ justifySelf: 'start' }}>
                      {busy ? STAGE[stage] : `Unlock the audit for ${fmtAda(Number(preview.priceLovelace), 0)}`}
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <div className="op-banner">No statement found. Paste CSV rows with a header like Date,Description,Amount.</div>
          )}
        </div>
      ) : null}

      {err ? <div className="op-banner">{err}</div> : null}

      {paid ? (
        <>
          <div className="op-card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <SealCheck size={22} color="var(--good)" />
            <span>Paid over x402 on Cardano preprod.</span>
            <a className="op-pill good" href={`${SCAN}/transaction/${paid.paymentTx}`} target="_blank" rel="noreferrer">
              {paid.paymentTx.slice(0, 10)}… <ArrowSquareOut size={14} />
            </a>
            <button className="link" onClick={() => (store.set(null), setPaid(null), setPreview(null))} style={{ marginLeft: 'auto', fontSize: 14 }}>
              Audit another statement
            </button>
          </div>
          <div className="op-card">
            <Report text={paid.report} />
          </div>
        </>
      ) : null}

      <p className="op-muted" style={{ fontSize: 13 }}>
        Preprod test network only, no real money. Findings come from the statement rows; messages are drafts for you to review. Agents can buy the same audit
        programmatically: <span className="op-mono">POST /api/x402/audit</span> answers 402 with the price.
      </p>
    </main>
  );
}
