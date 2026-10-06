'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Envelope, Table, LockSimple } from '@phosphor-icons/react';
import { api } from '@/product/api';
import { PageHead } from '@/product/ui';

const ACCEPT = '.eml,.mbox,.csv,.pdf';

async function toB64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function Connect() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /\.(eml|mbox|csv|pdf)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok]);
  };

  const run = async (mode: 'demo' | 'upload') => {
    setBusy(mode);
    setError(null);
    try {
      const payload =
        mode === 'demo' ? { mode } : { mode, files: await Promise.all(files.map(async (f) => ({ name: f.name, base64: await toB64(f) }))) };
      await api('/api/find/run', { method: 'POST', json: payload });
      router.push('/app');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead title="Connect your data" sub="Receipts and statements in, one ledger out" />
      <div className="op-grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="op-card" style={{ display: 'grid', gap: 20 }}>
          <div
            className={`op-drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add(e.dataTransfer.files);
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' }}>Drop your exports here</div>
            <p className="op-muted" style={{ margin: '8px 0 20px' }}>
              Email receipts as .eml or .mbox, and a card statement as .csv or .pdf
            </p>
            <button className="op-btn plain" onClick={() => input.current?.click()}>
              Choose files
            </button>
            <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
          </div>
          {files.length ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {/\.csv$|\.pdf$/i.test(f.name) ? <Table size={18} /> : <Envelope size={18} />}
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <span className="op-muted num">{(f.size / 1024).toFixed(0)} KB</span>
                </div>
              ))}
              <div>
                <button className="op-btn" onClick={() => run('upload')} disabled={!!busy}>
                  <span className="ico"><ArrowRight size={20} /></span>
                  {busy === 'upload' ? 'Reading your exports…' : `Find money in ${files.length} file${files.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          ) : null}
          {error ? <div className="op-banner">{error}</div> : null}
        </div>

        <div className="op-grid" style={{ alignContent: 'start' }}>
          <div className="op-card dark" style={{ display: 'grid', gap: 16 }}>
            <h2>No exports handy?</h2>
            <p className="card-sub" style={{ fontSize: 15 }}>
              The demo account has six months of synthetic receipts and a card statement for Alex Rivera. It is labelled as demo data everywhere.
            </p>
            <div>
              <button className="op-btn lime" onClick={() => run('demo')} disabled={!!busy}>
                {busy === 'demo' ? 'Scanning…' : 'Use demo data'}
              </button>
            </div>
          </div>
          <div className="op-card" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <LockSimple size={20} />
              <h2 style={{ fontSize: 17 }}>How your data is handled</h2>
            </div>
            <Point text="Processed on this machine. Raw exports are never written to disk." />
            <Point text="Card numbers, addresses and phone numbers are redacted before any model sees text." />
            <Point text="Never used to train models." />
          </div>
        </div>
      </div>
    </>
  );
}

function Point({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, color: 'var(--ink-75)' }}>
      <FileText size={18} style={{ flex: 'none', marginTop: 2 }} />
      <span>{text}</span>
    </div>
  );
}
