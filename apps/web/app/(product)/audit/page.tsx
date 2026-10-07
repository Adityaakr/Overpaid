'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowSquareOut, ArrowsClockwise, Bank, CheckCircle, CircleNotch, ClipboardText, Copy, DownloadSimple, FileCsv, Handshake, LockKey,
  Receipt, SealCheck, ShieldCheck, Sparkle, TrendUp, UploadSimple, XCircle,
} from '@phosphor-icons/react';
import { API, api } from '@/product/api';
import { Logo } from '@/product/ui';
import { ConnectButton, errText, fmtAda, SCAN, useWallet } from '@/product/wallet';
import s from './audit.module.css';

type Kind = 'recover' | 'duplicate' | 'fee' | 'price_increase' | 'cancel_or_keep' | 'negotiate';
type ItemLite = { kind: Kind; label: string; title: string; category: string; cents: number; per: 'once' | 'year'; confidence: string };
type ItemFull = ItemLite & { why: string; action: string; rows: { date: string; descriptor: string; cents: number }[]; monthlyCents: number | null };
type Summary = {
  ok: boolean; warnings: string[]; currency: string; rows: number; months: number; from: string | null; to: string | null;
  moneyInCents: number; moneyOutCents: number; avgMonthlyOutCents: number; recurringMonthlyCents: number; claimCents: number; reviewYearCents: number;
  fixed: { title: string; category: string; monthlyCents: number }[];
};
type Preview = Summary & { items: ItemLite[]; priceLovelace: string };
type Paid = { report: string; actions: string; paymentTx: string; model: string; audit: Summary & { items: ItemFull[] } };
type Stage = 'idle' | 'quote' | 'build' | 'sign' | 'verify';

const STEPS: { key: Exclude<Stage, 'idle'>; label: string }[] = [
  { key: 'quote', label: 'Price quoted over HTTP 402' },
  { key: 'build', label: 'Payment prepared for your wallet' },
  { key: 'sign', label: 'You approve it in your wallet' },
  { key: 'verify', label: 'Verified on Cardano, audit runs' },
];
const KIND: Record<Kind, { color: string; bg: string; icon: ReactNode }> = {
  recover: { color: 'var(--good)', bg: 'var(--good-bg)', icon: <Receipt size={20} /> },
  duplicate: { color: 'var(--bad)', bg: 'var(--bad-bg)', icon: <Copy size={20} /> },
  fee: { color: 'var(--bad)', bg: 'var(--bad-bg)', icon: <Bank size={20} /> },
  price_increase: { color: 'var(--warn)', bg: 'var(--warn-bg)', icon: <TrendUp size={20} /> },
  cancel_or_keep: { color: '#2563eb', bg: 'rgba(37,99,235,0.1)', icon: <ArrowsClockwise size={20} /> },
  negotiate: { color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', icon: <Handshake size={20} /> },
};
const CLAIM_KEY = 'overpaid.auditClaim';
const store = {
  get: () => { try { return localStorage.getItem(CLAIM_KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? localStorage.setItem(CLAIM_KEY, v) : localStorage.removeItem(CLAIM_KEY); } catch {} },
};
const fetchClaim = async (claim: string): Promise<Paid | null> => {
  const r = await fetch(`${API}/api/x402/audit/claim/${claim}`).catch(() => null);
  return r?.ok ? ((await r.json()) as Paid) : null;
};
const money = (cents: number, cur = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
};

/** Splits the drafted "## Messages to send" section into one block per merchant, plus the next steps. */
function parseMessages(md: string) {
  const [msgPart = '', stepPart = ''] = md.split(/^## Next steps/m);
  const parts = msgPart.replace(/^## Messages to send\s*/m, '').split(/^\*\*(.+?)\*\*\s*$/m);
  const out: { to: string; body: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ to: parts[i]!.trim(), body: (parts[i + 1] ?? '').trim() });
  const steps = stepPart.split('\n').map((l) => l.replace(/^\s*(\d+\.|-)\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
  return { out, steps };
}

export default function Audit() {
  const w = useWallet();
  const fileRef = useRef<HTMLInputElement>(null);
  const [statement, setStatement] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  // A paid audit whose response was lost (closed tab, dropped connection) comes back from its claim id.
  useEffect(() => {
    const claim = store.get();
    if (claim) void fetchClaim(claim).then((p) => p && setPaid(p));
  }, []);

  const analyse = async (text: string) => {
    setErr(null);
    setPaid(null);
    setBusy(true);
    try {
      const p = await api<Preview>('/api/audit/preview', { method: 'POST', json: { statement: text } });
      setPreview(p);
      if (!p.ok) setErr(p.warnings[0] ?? 'We could not read that file. It needs a header row with a date, a description and an amount.');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const loadText = (text: string, name: string | null) => {
    setStatement(text);
    setFileName(name);
    setPreview(null);
    void analyse(text);
  };
  const onFile = async (f: File | undefined) => f && loadText(await f.text(), f.name);
  const sample = async () => loadText(await (await fetch('/sample-statement.csv')).text(), 'sample-statement.csv');

  // The x402 flow, exactly as any client runs it: 402 -> pay -> retry with the payment header.
  const pay = async () => {
    setErr(null);
    setBusy(true);
    try {
      setStage('quote');
      const url = `${API}/api/x402/audit`;
      const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statement }) });
      if (first.status !== 402) throw new Error(`expected a 402 price, got ${first.status}`);
      const required = JSON.parse(atob(first.headers.get('payment-required') ?? ''));
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
      if (res?.ok && body) setPaid(body as Paid);
      else if (res && res.status < 500 && body) {
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStage('idle');
      setBusy(false);
    }
  };

  const reset = () => {
    store.set(null);
    setPaid(null);
    setPreview(null);
    setStatement('');
    setFileName(null);
    setErr(null);
  };
  const download = () => {
    if (!paid) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([paid.report], { type: 'text/markdown' }));
    a.download = 'overpaid-audit.md';
    a.click();
  };

  const view: (Summary & { items: (ItemLite & Partial<ItemFull>)[] }) | null = paid ? paid.audit : preview;
  const cur = view?.currency ?? 'USD';
  const price = Number(preview?.priceLovelace ?? 2_000_000);
  const msgs = paid ? parseMessages(paid.actions) : null;
  const stepIdx = STEPS.findIndex((x) => x.key === stage);

  return (
    <div className={s.page}>
      <nav className={s.nav}>
        <a href="/" className={s.brand}>
          <Logo size={28} /> Overpaid
        </a>
        <div className={s.navLinks}>
          <a href="#agents" className={s.hideSm}>For agents</a>
          <a href="https://github.com/Adityaakr/Overpaid" target="_blank" rel="noreferrer" className={s.hideSm}>GitHub</a>
          <a href="/app" className="op-btn small">Open the app</a>
        </div>
      </nav>

      <main className={s.wrap}>
        {!view?.ok ? (
          <section className={s.hero}>
            <div>
              <span className={s.kicker}><i /> Live on Cardano preprod</span>
              <h1 className={s.h1}>See what your statement is quietly costing you.</h1>
              <p className={s.lede}>
                Drop in a bank or card export. In seconds you see every recurring charge priced per year, price rises, duplicate charges and fees, for free.
                Unlock the full audit with source rows and ready-to-send messages for {fmtAda(price, 0)}, paid per request from your own wallet.
              </p>
              <div className={s.trust}>
                <span><ShieldCheck size={16} /> Read in memory, never stored</span>
                <span><SealCheck size={16} /> Every number traced to your rows</span>
                <span><LockKey size={16} /> No account: pay per audit with x402</span>
              </div>
            </div>
            <div className={s.drop}>
              {!paste ? (
                <div
                  className={`${s.zone} ${over ? s.zoneOver : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => (e.preventDefault(), setOver(true))}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => (e.preventDefault(), setOver(false), void onFile(e.dataTransfer.files[0]))}
                >
                  <div className={s.zoneIcon}>{busy ? <CircleNotch size={24} /> : <UploadSimple size={24} />}</div>
                  <b>{busy ? 'Reading your statement…' : 'Drop your statement CSV here'}</b>
                  <span className={s.small}>Any bank or card export: comma or semicolon, US or European format, signed amounts or debit and credit columns.</span>
                  <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                </div>
              ) : (
                <>
                  <textarea className={`${s.textarea} op-mono`} rows={8} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder={'Date,Description,Amount\n2026-07-06,Cloud hosting subscription,-49.00\n…'} />
                  <button className="op-btn" onClick={() => analyse(statement)} disabled={busy || statement.trim().length < 20}>
                    {busy ? 'Reading…' : 'Analyse for free'}
                  </button>
                </>
              )}
              {fileName && !busy ? (
                <div className={s.fileChip}>
                  <span className={s.row}><FileCsv size={18} /> {fileName}</span>
                  <button className={s.linkBtn} onClick={reset}>Clear</button>
                </div>
              ) : null}
              <div className={s.row} style={{ justifyContent: 'space-between' }}>
                <button className={s.linkBtn} onClick={() => setPaste(!paste)}>{paste ? 'Upload a file instead' : 'Paste rows instead'}</button>
                <button className={s.linkBtn} onClick={sample}>Try a sample statement</button>
              </div>
              {err ? <div className="op-banner">{err}</div> : null}
            </div>
          </section>
        ) : null}

        {view?.ok ? (
          <>
            <div className={s.row} style={{ justifyContent: 'space-between' }}>
              <div>
                <h1 style={{ fontSize: 30, letterSpacing: '-0.03em', fontWeight: 500 }}>{paid ? 'Your recovery audit' : 'Here is what we found'}</h1>
                <div className={s.small} style={{ marginTop: 4 }}>
                  {fileName ? `${fileName} · ` : ''}{view.rows} transactions, {view.from} to {view.to} ({view.months} month{view.months === 1 ? '' : 's'})
                </div>
              </div>
              <div className={s.row}>
                {paid ? (
                  <>
                    <a className="op-pill good" href={`${SCAN}/transaction/${paid.paymentTx}`} target="_blank" rel="noreferrer">
                      <SealCheck size={14} /> Paid over x402 · {paid.paymentTx.slice(0, 8)}… <ArrowSquareOut size={12} />
                    </a>
                    <button className="op-btn small light" onClick={download}><DownloadSimple size={16} /> Download</button>
                  </>
                ) : null}
                <button className="op-btn small light" onClick={reset}>New statement</button>
              </div>
            </div>

            <div className={s.stats}>
              <div className={`${s.stat} ${s.feature}`}>
                <span className={s.statLabel}>Recurring spend to cut or review</span>
                <span className={s.statValue}>{money(view.reviewYearCents, cur)}<small style={{ fontSize: 15, opacity: 0.7 }}> /yr</small></span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>To claim back now</span>
                <span className={s.statValue} style={{ color: view.claimCents ? 'var(--good)' : undefined }}>{money(view.claimCents, cur)}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Recurring charges</span>
                <span className={s.statValue}>{money(view.recurringMonthlyCents, cur)}<small style={{ fontSize: 15, color: 'var(--ink-50)' }}> /mo</small></span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>Average money out</span>
                <span className={s.statValue}>{money(view.avgMonthlyOutCents, cur)}<small style={{ fontSize: 15, color: 'var(--ink-50)' }}> /mo</small></span>
              </div>
            </div>

            <div className={s.results}>
              <div style={{ display: 'grid', gap: 20 }}>
                <div className={s.list}>
                  <div className={s.listHead}>
                    <h2 style={{ fontSize: 18, fontWeight: 600 }}>{view.items.length} thing{view.items.length === 1 ? '' : 's'} to act on</h2>
                    <span className={s.small}>Claims first, then by yearly cost</span>
                  </div>
                  {view.items.length === 0 ? (
                    <div className={s.locked}><CheckCircle size={20} /> No duplicates, fees, price rises or reviewable recurring charges. This statement looks clean.</div>
                  ) : null}
                  {view.items.map((it, i) => {
                    const k = KIND[it.kind];
                    return (
                      <div key={i} className={s.item}>
                        <div className={s.itemIcon} style={{ background: k.bg, color: k.color }}>{k.icon}</div>
                        <div>
                          <div className={s.itemTitle}>{it.title}</div>
                          <div className={s.itemMeta}>
                            <span className={s.badge} style={{ background: k.bg, color: k.color }}>{it.label}</span>
                            <span>{it.category}</span>
                            <span>· {it.confidence} confidence</span>
                          </div>
                        </div>
                        <div className={s.amount}>
                          {money(it.cents, cur)}
                          <small>{it.per === 'year' ? 'per year' : 'one-off'}</small>
                        </div>
                        {paid && it.why ? (
                          <div className={s.detail}>
                            <span>{it.why}</span>
                            <div className={s.action}><b>What to do:</b> {it.action}</div>
                            <div className={s.rows}>
                              {it.rows?.slice(0, 6).map((r, j) => (
                                <span key={j}>{r.date} · {r.descriptor} · {money(r.cents, cur)}</span>
                              ))}
                              {it.rows && it.rows.length > 6 ? <span>and {it.rows.length - 6} more</span> : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!paid && view.items.length ? (
                    <div className={s.locked}>
                      <LockKey size={20} /> The full audit adds why each item was flagged, its exact source rows, what to do, and a ready-to-send message for each merchant.
                    </div>
                  ) : null}
                  {view.fixed.length ? (
                    <div className={s.small} style={{ padding: '10px 16px 14px' }}>
                      Fixed costs left out of the actions: {view.fixed.map((f) => `${f.title} ${money(f.monthlyCents, cur)}/mo`).join(', ')}.
                    </div>
                  ) : null}
                </div>

                {msgs && msgs.out.length ? (
                  <div className={s.messages}>
                    <div className={s.row} style={{ justifyContent: 'space-between' }}>
                      <h2 style={{ fontSize: 18, fontWeight: 600 }}><Sparkle size={18} style={{ verticalAlign: -3 }} /> Messages to send</h2>
                      <span className={s.small}>Drafted by Claude from the findings above. Review before sending.</span>
                    </div>
                    {msgs.out.map((m, i) => (
                      <div key={i} className={s.msg}>
                        <div className={s.row} style={{ justifyContent: 'space-between' }}>
                          <b>To: {m.to}</b>
                          <button className="op-btn small light" onClick={() => (void navigator.clipboard.writeText(m.body), setCopied(i), setTimeout(() => setCopied(null), 1500))}>
                            <ClipboardText size={15} /> {copied === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                      </div>
                    ))}
                    {msgs.steps.length ? (
                      <div>
                        <b>Next steps</b>
                        <ol style={{ margin: '8px 0 0 18px', display: 'grid', gap: 4, fontSize: 14 }}>
                          {msgs.steps.map((x, i) => <li key={i}>{x}</li>)}
                        </ol>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <aside className={s.side}>
                {!paid ? (
                  <div className={s.unlock}>
                    <div>
                      <div className={s.small} style={{ color: 'rgba(255,255,255,0.6)' }}>Full audit</div>
                      <div className={s.price}>{fmtAda(price, 0)}</div>
                      <div className={s.small} style={{ color: 'rgba(255,255,255,0.6)' }}>Paid once, per request, over x402 on Cardano preprod</div>
                    </div>
                    <ul>
                      <li><CheckCircle size={16} /> Reasons and source rows for every item</li>
                      <li><CheckCircle size={16} /> A ready-to-send message per merchant</li>
                      <li><CheckCircle size={16} /> Next steps ordered by money at stake</li>
                      <li><CheckCircle size={16} /> A report you can download</li>
                    </ul>
                    <div className={s.walletBox} style={{ background: 'var(--card)', color: 'var(--ink)' }}>
                      <ConnectButton compact />
                    </div>
                    {w.address && view.items.length ? (
                      <button className="op-btn lime" onClick={pay} disabled={busy}>
                        {busy ? 'Working…' : `Unlock for ${fmtAda(price, 0)}`}
                      </button>
                    ) : null}
                    {stepIdx >= 0 ? (
                      <div className={s.steps}>
                        {STEPS.map((st, i) => (
                          <span key={st.key} className={`${s.step} ${i < stepIdx ? s.stepDone : i === stepIdx ? s.stepNow : ''}`}>
                            {i < stepIdx ? <CheckCircle size={16} /> : i === stepIdx ? <CircleNotch size={16} /> : <span style={{ width: 16 }} />}
                            {st.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {err ? <div className="op-banner" style={{ display: 'flex', gap: 8 }}><XCircle size={18} /> {err}</div> : null}
                  </div>
                ) : (
                  <div className="op-card" style={{ display: 'grid', gap: 10 }}>
                    <h2 style={{ fontSize: 17 }}>Proof of payment</h2>
                    <div className={s.small}>Your wallet paid {fmtAda(price, 0)} over x402. The facilitator verified the signed transaction before the audit ran.</div>
                    <a className="op-pill good" href={`${SCAN}/transaction/${paid.paymentTx}`} target="_blank" rel="noreferrer" style={{ justifySelf: 'start' }}>
                      View on Cardanoscan <ArrowSquareOut size={12} />
                    </a>
                  </div>
                )}
                <div className="op-card" id="agents" style={{ display: 'grid', gap: 8 }}>
                  <h2 style={{ fontSize: 16 }}>For agents</h2>
                  <div className={s.fine}>
                    The same audit is an x402 resource: <span className={s.code}>POST /api/x402/audit</span> answers <span className={s.code}>402</span> with the price, and any x402 Cardano client pays and retries. No account, no API key.
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : null}

        <p className={s.fine} style={{ textAlign: 'center' }}>
          Preprod test network, no real money. Recurring charges are listed to review: a statement shows what you pay, not whether you use it.
        </p>
      </main>
    </div>
  );
}
