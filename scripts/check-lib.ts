// Shared helpers for milestone checks. Each check prints a short summary and exits non-zero on failure.
export const API = process.env.API_URL ?? 'http://localhost:4000';
export async function call<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
export function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok   ${msg}`);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
