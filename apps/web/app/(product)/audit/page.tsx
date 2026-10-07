'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowSquareOut, ArrowsClockwise, Bank, CheckCircle, CircleNotch, ClipboardText, Copy, DownloadSimple, FileCsv, Handshake, LockKey,
  Receipt, SealCheck, ShieldCheck, Sparkle, TrendUp, UploadSimple, XCircle,
} from '@phosphor-icons/react';
import { API, api } from '@/product/api';
import { Logo } from '@/product/ui';
import { errText, SCAN } from '@/product/wallet';
import s from './audit.module.css';

type Kind = 'recover' | 'duplicate' | 'fee' | 'price_increase' | 'cancel_or_keep' | 'negotiate';
type ItemLite = { kind: Kind; label: string; title: string; category: string; cents: number; per: 'once' | 'year'; confidence: string };
type ItemFull = ItemLite & { why: string; action: string; rows: { date: string; descriptor: string; cents: number }[]; monthlyCents: number | null };
type Summary = {
  ok: boolean; warnings: string[]; currency: string; rows: number; months: number; from: string | null; to: string | null;
  moneyInCents: number; moneyOutCents: number; avgMonthlyOutCents: number; recurringMonthlyCents: number; claimCents: number; reviewYearCents: number;
  fixed: { title: string; category: string; monthlyCents: number }[];
};
type Preview = Summary & { items: ItemFull[]; priceLovelace: string };
type Paid = { report: string; actions: string; paymentTx: string; model: string; audit: Summary & { items: ItemFull[] } };

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [statement, setStatement] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [actions, setActions] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

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
    setActions(null);
    void analyse(text);
  };
  const onFile = async (f: File | undefined) => f && loadText(await f.text(), f.name);
  const draft = async () => {
    setErr(null);
    setDrafting(true);
    try {
      const r = await api<{ actions: string }>('/api/audit/messages', { method: 'POST', json: { statement } });
      setActions(r.actions);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setDrafting(false);
    }
  };
  const sample = async () => loadText(await (await fetch('/sample-statement.csv')).text(), 'sample-statement.csv');

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
  const msgs = paid ? parseMessages(paid.actions) : actions ? parseMessages(actions) : null;

  return (
    <div className={s.page}>
      <nav className={s.nav}>
        <a href="/" className={s.brand}>
          <Logo size={28} /> Clawback
        </a>
        <div className={s.navLinks}>
          <a href="#agents" className={s.hideSm}>For agents</a>
          <a href="https://github.com/Adityaakr/Clawback" target="_blank" rel="noreferrer" className={s.hideSm}>GitHub</a>
          <a href="/app" className="op-btn small">Open the app</a>
        </div>
      </nav>

      <main className={s.wrap}>
        {!view?.ok ? (
          <section className={s.hero}>
            <div>
              <span className={s.kicker}><i /> Free audit, no account</span>
              <h1 className={s.h1}>See what your statement is quietly costing you.</h1>
              <p className={s.lede}>
                Drop in a bank or card export. In seconds you see every recurring charge priced per year, price rises, duplicate charges and fees, with the rows behind each one and a drafted message to send. Free.
                Then put it on autopilot: Clawback keeps watching, and you pay only on money that comes back.
              </p>
              <div className={s.trust}>
                <span><ShieldCheck size={16} /> Read in memory, never stored</span>
                <span><SealCheck size={16} /> Every number traced to your rows</span>
                <span><LockKey size={16} /> Agents pay per request over x402</span>
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
                <h1 style={{ fontSize: 30, letterSpacing: '-0.03em', fontWeight: 500 }}>Your recovery audit</h1>
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
                        {it.why ? (
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
                  {!msgs && view.items.length ? (
                    <div className={s.locked}>
                      <Sparkle size={20} /> Want the messages written for you? Claude drafts one per merchant from these findings, free.
                      <button className="op-btn small" style={{ marginLeft: 'auto' }} onClick={draft} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft the messages'}</button>
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
                      <div className={s.small} style={{ color: 'rgba(255,255,255,0.6)' }}>Put it on autopilot</div>
                      <div className={s.price}>Free to run</div>
                      <div className={s.small} style={{ color: 'rgba(255,255,255,0.6)' }}>A success fee only on money confirmed back</div>
                    </div>
                    <ul>
                      <li><CheckCircle size={16} /> Keeps watching every charge you connect</li>
                      <li><CheckCircle size={16} /> Agents cancel, claim and renegotiate what you approve</li>
                      <li><CheckCircle size={16} /> Specialists hired into escrow when a claim needs one</li>
                      <li><CheckCircle size={16} /> A review every Sunday; keep or remove in one tap</li>
                    </ul>
                    <a className="op-btn lime" href="/app/connect">Start my autopilot</a>
                    <div className={s.small} style={{ color: 'rgba(255,255,255,0.55)' }}>Today you connect by uploading an export; bank connections are next. Cardano preprod, test money.</div>
                    {err ? <div className="op-banner" style={{ display: 'flex', gap: 8 }}><XCircle size={18} /> {err}</div> : null}
                  </div>
                ) : (
                  <div className="op-card" style={{ display: 'grid', gap: 10 }}>
                    <h2 style={{ fontSize: 17 }}>Proof of payment</h2>
                    <div className={s.small}>This audit was bought over x402. The facilitator verified the signed transaction before the audit ran.</div>
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
