import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const LOCAL = join(import.meta.dirname, '..', '.local');
export const MPS_URL = (process.env.MPS_URL ?? 'http://127.0.0.1:3012').replace(/\/+$/, '') + '/api/v1';
export const USDM = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
export const QUOTE = process.env.COWORKER_QUOTE_ATOMIC ?? '1000000';

export interface Registration {
  agentIdentifier: string;
  supportedPaymentSourceIndex: number;
  walletId: string;
  sellerAddress: string;
  state?: string;
}

export const registration = (): Registration | null => {
  const p = join(LOCAL, 'registration.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

function runtimeToken() {
  const p = join(LOCAL, 'mps-runtime.env');
  const t = existsSync(p) ? parseEnv(readFileSync(p, 'utf8')).MPS_RUNTIME_TOKEN : undefined;
  if (!t || t.startsWith('*****')) throw new Error('MPS runtime token missing; run the register script');
  return t;
}

/** Calls the payment node with the scoped ReadAndPay token (never the admin key). */
export async function mps<T = any>(path: string, body?: unknown, token = runtimeToken()): Promise<T> {
  const res = await fetch(MPS_URL + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: { token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data.status !== 'success') throw new Error(`MPS ${path} HTTP ${res.status}: ${JSON.stringify(data.error ?? data.message ?? '').slice(0, 200)}`);
  return data.data as T;
}

export const confirmedState = (p: any, state: string): boolean =>
  (p.CurrentTransaction?.status === 'Confirmed' && p.CurrentTransaction?.newOnChainState === state) ||
  (p.TransactionHistory ?? []).some((t: any) => t.status === 'Confirmed' && t.newOnChainState === state);
