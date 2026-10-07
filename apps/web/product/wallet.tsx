'use client';
/**
 * CIP-30 browser wallet (Lace, Eternl, ...) on Cardano preprod.
 * The browser never sees a mnemonic: the API builds unsigned transactions, the wallet signs them,
 * and the API merges the returned witness set and submits.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowSquareOut, Wallet as WalletIcon } from '@phosphor-icons/react';
import { api } from './api';

// ---------- CIP-30 types ----------
type Cip30Api = {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  getUsedAddresses?(paginate?: unknown): Promise<string[]>;
  getUnusedAddresses?(): Promise<string[]>;
  getBalance(): Promise<string>;
  getUtxos(amount?: string, paginate?: unknown): Promise<string[] | null | undefined>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
};
type Cip30Wallet = { name?: string; icon?: string; apiVersion?: string; enable(): Promise<Cip30Api>; isEnabled?(): Promise<boolean> };
type WindowCardano = Record<string, Cip30Wallet | unknown>;

export type WalletOption = { key: string; name: string; icon: string | null };
export type WalletDiag = { key: string; apiVersion: string | null; networkId: number | null; change: string | null; used: string[]; unused: string[]; steps: string[] };

/** CIP-30 calls can hang in multi-chain wallets; never let one call freeze the page. */
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} did not answer within ${ms / 1000}s`)), ms))]);

export const SCAN = 'https://preprod.cardanoscan.io';
export const FAUCET = 'https://docs.cardano.org/cardano-testnets/tools/faucet';
export const LACE = 'https://www.lace.io';
const STORE_KEY = 'op.wallet';
const LOW_BALANCE = 10_000_000n;

// ---------- bech32 (BIP-173) ----------
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
function bech32Encode(hrp: string, bytes: Uint8Array) {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const hrpExp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod([...hrpExp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`;
}
const hexBytes = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** The first Preprod (addr_test1) address the wallet exposes: change, then used, then unused. */
async function preprodAddress(w: Cip30Api, trace?: Partial<WalletDiag>): Promise<{ preprod: string | null; first: string | null }> {
  const steps = trace?.steps ?? [];
  const lists: string[][] = [];
  try { const c = addressToBech32(await withTimeout(w.getChangeAddress(), 8000, 'getChangeAddress')); lists.push([c]); if (trace) trace.change = c; steps.push(`change ${c.slice(0, 14)}…`); } catch (e) { steps.push(`getChangeAddress failed: ${errText(e)}`); }
  try { if (w.getUsedAddresses) { const u = ((await withTimeout(w.getUsedAddresses(), 8000, 'getUsedAddresses')) ?? []).map(addressToBech32); lists.push(u); if (trace) trace.used = u.slice(0, 5); steps.push(`used ${u.length}`); } } catch (e) { steps.push(`getUsedAddresses failed: ${errText(e)}`); }
  try { if (w.getUnusedAddresses) { const u = ((await withTimeout(w.getUnusedAddresses(), 8000, 'getUnusedAddresses')) ?? []).map(addressToBech32); lists.push(u); if (trace) trace.unused = u.slice(0, 5); steps.push(`unused ${u.length}`); } } catch (e) { steps.push(`getUnusedAddresses failed: ${errText(e)}`); }
  const all = lists.flat().filter(Boolean);
  return { preprod: all.find((a) => a.startsWith('addr_test1')) ?? null, first: all[0] ?? null };
}

/** CIP-30 returns raw address bytes as hex; render them as a CIP-19 bech32 address. */
export function addressToBech32(hexOrBech: string) {
  if (!/^[0-9a-f]+$/i.test(hexOrBech)) return hexOrBech; // some wallets already return bech32
  const bytes = hexBytes(hexOrBech);
  const type = bytes[0] >> 4;
  const testnet = (bytes[0] & 0x0f) === 0;
  const hrp = type === 14 || type === 15 ? (testnet ? 'stake_test' : 'stake') : testnet ? 'addr_test' : 'addr';
  return bech32Encode(hrp, bytes);
}

/** getBalance returns a CBOR Value: either a coin (uint) or [coin, multiasset]. We only need the coin. */
export function lovelaceFromValueCbor(hex: string): bigint {
  const b = hexBytes(hex);
  let i = 0;
  const readUint = (): bigint => {
    const ib = b[i++];
    const major = ib >> 5;
    const ai = ib & 31;
    if (major === 4) return readUint(); // array: first element is coin
    if (major !== 0) throw new Error('unexpected CBOR in balance');
    if (ai < 24) return BigInt(ai);
    const len = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : 0;
    if (!len) throw new Error('unexpected CBOR length in balance');
    let v = 0n;
    for (let k = 0; k < len; k++) v = (v << 8n) | BigInt(b[i++]);
    return v;
  };
  return readUint();
}

export const fmtAda = (lovelace: number | bigint | null | undefined, digits = 2) =>
  lovelace == null ? '—' : `${(Number(lovelace) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} tADA`;
export const shortAddr = (a: string | null | undefined, head = 12, tail = 6) => (a ? (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a) : '');

/** Human text for API errors (`"400 {"error":"..."}"`) and CIP-30 errors (`{code, info}`). */
export function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'info' in e && typeof (e as { info: unknown }).info === 'string') {
    const { code, info } = e as { code?: number; info: string };
    return code === 2 || code === -3 || /declin|reject|cancel/i.test(info) ? 'You declined in your wallet.' : info;
  }
  const msg = e instanceof Error ? e.message : String(e ?? 'Something went wrong');
  const body = msg.replace(/^\d{3}\s*/, '');
  try {
    const j = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof j.error === 'string') return j.error;
    if (typeof j.message === 'string') return j.message;
  } catch {}
  return body || msg;
}

// ---------- context ----------
type WalletState = {
  available: WalletOption[];
  detecting: boolean;
  walletKey: string | null;
  walletName: string | null;
  address: string | null;
  balanceLovelace: bigint | null;
  wrongNetwork: boolean;
  /** The first address the wallet gave us, shown when it is not on Preprod. */
  seenAddress: string | null;
  /** What the wallet actually answered during connect, for the wallet page and support. */
  diag: WalletDiag | null;
  connecting: boolean;
  error: string | null;
  connect(key: string): Promise<void>;
  disconnect(): void;
  refresh(): Promise<void>;
  getUtxosHex(): Promise<string[]>;
  signTx(txCbor: string, partial?: boolean): Promise<string>;
};

const Ctx = createContext<WalletState | null>(null);

function readCardano(): WindowCardano | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { cardano?: WindowCardano }).cardano ?? null) as WindowCardano | null;
}
function listWallets(): WalletOption[] {
  const c = readCardano();
  if (!c) return [];
  const out: WalletOption[] = [];
  const seen = new Set<string>();
  for (const [key, w] of Object.entries(c)) {
    if (!w || typeof w !== 'object' || typeof (w as Cip30Wallet).enable !== 'function') continue;
    const wallet = w as Cip30Wallet;
    const name = wallet.name || key;
    if (seen.has(name.toLowerCase())) continue; // some wallets register twice (e.g. "lace" and an alias)
    seen.add(name.toLowerCase());
    out.push({ key, name: name.charAt(0).toUpperCase() + name.slice(1), icon: typeof wallet.icon === 'string' ? wallet.icon : null });
  }
  return out;
}
const storeGet = () => {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const storeSet = (v: string | null) => {
  try {
    if (v) localStorage.setItem(STORE_KEY, v);
    else localStorage.removeItem(STORE_KEY);
  } catch {}
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<WalletOption[]>([]);
  const [detecting, setDetecting] = useState(true);
  const [walletKey, setWalletKey] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [seenAddress, setSeenAddress] = useState<string | null>(null);
  const [diag, setDiag] = useState<WalletDiag | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<Cip30Api | null>(null);

  const load = useCallback(async (w: Cip30Api) => {
    // Trust addresses over getNetworkId: multi-chain wallets can report mainnet while serving a testnet account,
    // and some hand out a mainnet change address while their used addresses are on Preprod.
    const trace: WalletDiag = { key: '', apiVersion: null, networkId: null, change: null, used: [], unused: [], steps: [] };
    try { trace.networkId = await withTimeout(w.getNetworkId(), 5000, 'getNetworkId'); trace.steps.push(`networkId ${trace.networkId}`); } catch (e) { trace.steps.push(`getNetworkId failed: ${errText(e)}`); }
    const { preprod, first } = await preprodAddress(w, trace);
    setDiag((d) => ({ ...trace, key: d?.key ?? '', apiVersion: d?.apiVersion ?? null }));
    setSeenAddress(first);
    if (!preprod) {
      setWrongNetwork(true);
      setAddress(null);
      setBalance(null);
      return;
    }
    const addr = preprod;
    setWrongNetwork(false);
    setAddress(addr);
    try {
      if (addressToBech32(await w.getChangeAddress()) !== addr) throw new Error('balance belongs to another address');
      setBalance(lovelaceFromValueCbor(await w.getBalance()));
    } catch {
      // Fall back to the API's view of the address if the wallet's CBOR is unusual.
      api<{ lovelace: number | string }>(`/api/me/balance?address=${encodeURIComponent(addr)}`)
        .then((r) => setBalance(BigInt(r.lovelace)))
        .catch(() => setBalance(null));
    }
  }, []);

  const connect = useCallback(
    async (key: string) => {
      const w = readCardano()?.[key] as Cip30Wallet | undefined;
      if (!w) {
        setError('That wallet is not available in this browser.');
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        const handle = await withTimeout(w.enable(), 60_000, 'The wallet connection popup');
        apiRef.current = handle;
        setDiag({ key, apiVersion: w.apiVersion ?? null, networkId: null, change: null, used: [], unused: [], steps: [] });
        setWalletKey(key);
        setWalletName(listWallets().find((o) => o.key === key)?.name ?? key);
        storeSet(key);
        await load(handle);
      } catch (e) {
        apiRef.current = null;
        setWalletKey(null);
        setError(errText(e));
      } finally {
        setConnecting(false);
      }
    },
    [load],
  );

  const disconnect = useCallback(() => {
    apiRef.current = null;
    storeSet(null);
    setWalletKey(null);
    setWalletName(null);
    setAddress(null);
    setBalance(null);
    setWrongNetwork(false);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!apiRef.current) return;
    try {
      await load(apiRef.current);
    } catch (e) {
      setError(errText(e));
    }
  }, [load]);

  // Wallet extensions inject window.cardano asynchronously; poll briefly, then auto-reconnect.
  useEffect(() => {
    let cancelled = false;
    const saved = storeGet();
    let tried = false;
    const timers = [0, 300, 1000, 2500].map((ms, idx, all) =>
      setTimeout(async () => {
        if (cancelled) return;
        const list = listWallets();
        setAvailable(list);
        if (idx === all.length - 1) setDetecting(false);
        if (saved && !tried && list.some((o) => o.key === saved)) {
          tried = true;
          const w = readCardano()?.[saved] as Cip30Wallet;
          // Only reconnect silently; never pop a wallet prompt on page load.
          const ok = w.isEnabled ? await w.isEnabled().catch(() => false) : false;
          if (ok && !cancelled) void connect(saved);
        }
      }, ms),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [connect]);

  // Keep the balance fresh: on focus and every 30s while connected.
  useEffect(() => {
    if (!walletKey) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const t = setInterval(onFocus, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [walletKey, refresh]);

  const getUtxosHex = useCallback(async () => {
    if (!apiRef.current) throw new Error('Connect your wallet first.');
    return ((await apiRef.current.getUtxos()) ?? []).filter(Boolean);
  }, []);

  const signTx = useCallback(async (txCbor: string, partial = true) => {
    if (!apiRef.current) throw new Error('Connect your wallet first.');
    if (!(await preprodAddress(apiRef.current)).preprod) throw new Error('Switch your wallet to Preprod.');
    return withTimeout(apiRef.current.signTx(txCbor, partial), 120_000, 'The wallet signing popup');
  }, []);

  return (
    <Ctx.Provider
      value={{
        available,
        detecting,
        walletKey,
        walletName,
        address,
        balanceLovelace: balance,
        wrongNetwork,
        seenAddress,
        diag,
        connecting,
        error,
        connect,
        disconnect,
        refresh,
        getUtxosHex,
        signTx,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used inside <WalletProvider>');
  return v;
}

/**
 * The one flow every wallet action uses:
 * POST build {address, utxos, ...} -> {txCbor, ...} -> wallet.signTx(txCbor, partial) -> POST submit {txCbor, witnessSet, ...}.
 * The server merges the witness set into the tx body it built and submits it to preprod.
 */
export async function buildSignSubmit<B extends { txCbor: string }, S>(
  w: WalletState,
  opts: { build: string; buildBody?: Record<string, unknown>; submit: string; submitBody?: Record<string, unknown>; onStage?: (s: 'building' | 'signing' | 'submitting') => void },
): Promise<{ built: B; result: S }> {
  if (!w.address) throw new Error(w.wrongNetwork ? 'Switch your wallet to Preprod.' : 'Connect your wallet first.');
  opts.onStage?.('building');
  const utxos = await w.getUtxosHex();
  const built = await api<B>(opts.build, { method: 'POST', json: { address: w.address, utxos, ...opts.buildBody } });
  opts.onStage?.('signing');
  const witnessSet = await w.signTx(built.txCbor, true);
  opts.onStage?.('submitting');
  const result = await api<S>(opts.submit, { method: 'POST', json: { txCbor: built.txCbor, witnessSet, ...opts.submitBody } });
  void w.refresh();
  return { built, result };
}

// ---------- UI ----------
function WalletChoices({ compact }: { compact?: boolean }) {
  const w = useWallet();
  if (w.available.length === 0) {
    return w.detecting ? (
      <div className="op-muted">Looking for a Cardano wallet…</div>
    ) : (
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="op-muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          No Cardano wallet found in this browser. Install Lace (or Eternl), create a wallet, and switch it to the Preprod test network. Preprod tADA is free test money.
        </div>
        <a className="op-btn" href={LACE} target="_blank" rel="noreferrer" style={{ justifySelf: 'start' }}>
          <span className="ico"><ArrowSquareOut size={18} /></span>
          Get Lace
        </a>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {w.available.map((o) => (
        <button key={o.key} className={`op-btn${compact ? ' small' : ''}`} onClick={() => w.connect(o.key)} disabled={w.connecting}>
          {compact ? null : (
            <span className="ico">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.icon ? <img src={o.icon} alt="" width={22} height={22} /> : <WalletIcon size={20} />}
            </span>
          )}
          {w.connecting ? 'Connecting…' : `Connect ${o.name}`}
        </button>
      ))}
    </div>
  );
}

/** Full connect panel: wallet choices, preprod check, connected address + balance, faucet when low. */
export function ConnectButton({ compact }: { compact?: boolean }) {
  const w = useWallet();
  if (w.wrongNetwork) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="op-banner" style={{ display: 'grid', gap: 6 }}>
          <span>
            {w.walletName ?? 'Your wallet'} shared a mainnet address{w.seenAddress ? ` (${shortAddr(w.seenAddress, 10, 6)})` : ''}. This app runs on Cardano Preprod, so it needs an address starting with addr_test1.
          </span>
          {/subwallet/i.test(w.walletName ?? '') ? (
            <span>
              In SubWallet: open Manage networks and turn off Cardano (mainnet), keep Cardano Preprod on, then disconnect this site in SubWallet and connect again. If it still shares a mainnet address, Lace (Settings, Network, Preprod) works reliably.
            </span>
          ) : (
            <span>Switch the wallet's network to Preprod, then check again.</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="op-btn plain small" onClick={() => w.refresh()}>I switched, check again</button>
          <button className="op-btn plain small" onClick={w.disconnect}>Disconnect</button>
        </div>
        <WalletDiagnostics compact />
      </div>
    );
  }
  if (!w.address) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <WalletChoices compact={compact} />
        {w.error ? <div className="op-banner">{w.error}</div> : null}
      </div>
    );
  }
  const low = w.balanceLovelace !== null && w.balanceLovelace < LOW_BALANCE;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="op-pill good">{w.walletName} · Preprod</span>
        <a className="op-mono link" href={`${SCAN}/address/${w.address}`} target="_blank" rel="noreferrer" title={w.address}>
          {shortAddr(w.address)}
        </a>
        <b className="num">{fmtAda(w.balanceLovelace)}</b>
      </div>
      {low ? (
        <div className="op-banner">
          Under 10 tADA. Get free test ADA from the{' '}
          <a className="link" href={FAUCET} target="_blank" rel="noreferrer">
            Cardano faucet <ArrowSquareOut size={14} style={{ verticalAlign: -2 }} />
          </a>
        </div>
      ) : null}
      {w.error ? <div className="op-banner">{w.error}</div> : null}
    </div>
  );
}

/** Rail slot: wallet state at a glance; links to the wallet page. */
export function WalletRailButton() {
  const w = useWallet();
  const label = w.address
    ? `${w.walletName}: ${shortAddr(w.address, 10, 4)} · ${fmtAda(w.balanceLovelace, 1)}`
    : w.wrongNetwork
      ? 'Switch your wallet to Preprod'
      : 'Connect a Cardano wallet';
  return (
    <Link href="/app/wallet" className={`op-wallet${w.address ? ' on' : ''}${w.wrongNetwork ? ' warn' : ''}`} aria-label={label}>
      <WalletIcon size={22} weight={w.address ? 'fill' : 'light'} />
      {w.address ? <span className="bal num">{(Number(w.balanceLovelace ?? 0n) / 1_000_000).toFixed(0)}</span> : null}
      <span className="tip">{label}</span>
    </Link>
  );
}

/** What the wallet answered during connect. Shown on the wallet page and under a network warning, so a
 *  wallet that misbehaves can be diagnosed from a screenshot. */
export function WalletDiagnostics({ compact }: { compact?: boolean }) {
  const w = useWallet();
  const d = w.diag;
  if (!d) return null;
  const net = d.networkId === 0 ? 'Preprod/testnet (0)' : d.networkId === 1 ? 'mainnet (1)' : d.networkId === null ? 'no answer' : String(d.networkId);
  return (
    <details className="op-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }} open={!compact}>
      <summary style={{ cursor: 'pointer' }}>What {w.walletName ?? d.key} told us</summary>
      <div className="op-mono" style={{ display: 'grid', gap: 2, marginTop: 6 }}>
        <span>provider: window.cardano.{d.key} · api {d.apiVersion ?? '?'}</span>
        <span>networkId: {net}</span>
        <span>change: {d.change ? `${d.change.slice(0, 18)}…` : 'none'}</span>
        <span>used: {d.used.length ? d.used.map((a) => a.slice(0, 12)).join(', ') : 'none'} · unused: {d.unused.length ? d.unused.map((a) => a.slice(0, 12)).join(', ') : 'none'}</span>
        {d.steps.filter((x) => /failed/.test(x)).map((x, i) => <span key={i} style={{ color: 'var(--bad)' }}>{x}</span>)}
      </div>
    </details>
  );
}
