/**
 * Blockfrost preprod access: an Evolution read client and a small REST helper, both with hard timeouts.
 * Validity windows are always built from chain time (latest block), never the local clock.
 */
import { Client, preprod } from '@evolution-sdk/evolution';
import { requireBlockfrost, type BlockfrostConfig } from './env.js';

export const DEFAULT_TIMEOUT_MS = 20_000;

export class TimeoutError extends Error {}

export async function withTimeout<T>(p: PromiseLike<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new TimeoutError(`${what} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export class BlockfrostError extends Error {
  constructor(readonly status: number, readonly path: string, body: string) {
    super(`Blockfrost ${path} -> ${status}: ${body.slice(0, 200)}`);
  }
}

export interface Blockfrost {
  config: BlockfrostConfig;
  /** GET a Blockfrost path; returns null on 404. */
  get<T>(path: string): Promise<T | null>;
  /** Chain time (ms) of the latest block. */
  tipMs(): Promise<bigint>;
}

export function blockfrost(config: BlockfrostConfig = requireBlockfrost(), timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl: typeof fetch = fetch): Blockfrost {
  async function get<T>(path: string): Promise<T | null> {
    const res = await fetchImpl(`${config.baseUrl}${path}`, { headers: { project_id: config.projectId }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) return null;
    if (!res.ok) throw new BlockfrostError(res.status, path, await res.text().catch(() => ''));
    return (await res.json()) as T;
  }
  return {
    config,
    get,
    async tipMs() {
      const b = await get<{ time: number }>('/blocks/latest');
      if (!b) throw new Error('Blockfrost /blocks/latest returned 404');
      return BigInt(b.time) * 1000n;
    },
  };
}

export function readClient(config: BlockfrostConfig = requireBlockfrost()) {
  return Client.make(preprod).withBlockfrost(config);
}

/** Lovelace + token balance of an address via Blockfrost (null if the address has never been used). */
export async function addressBalance(bf: Blockfrost, address: string): Promise<{ lovelace: bigint; tokens: Record<string, bigint> } | null> {
  const r = await bf.get<{ amount: Array<{ unit: string; quantity: string }> }>(`/addresses/${address}`);
  if (!r) return null;
  const tokens: Record<string, bigint> = {};
  let lovelace = 0n;
  for (const a of r.amount) {
    if (a.unit === 'lovelace') lovelace = BigInt(a.quantity);
    else tokens[a.unit] = BigInt(a.quantity);
  }
  return { lovelace, tokens };
}

/** Poll Blockfrost until the tx is indexed (included in a block). */
export async function awaitTx(bf: Blockfrost, txHash: string, timeoutMs = 300_000, pollMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await bf.get(`/txs/${txHash}`).catch(() => null)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}
