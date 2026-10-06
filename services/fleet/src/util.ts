export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry with exponential backoff (base, 2x, 4x...). `retryable` decides whether an error is worth retrying. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; retryable?: (e: unknown) => boolean; onRetry?: (e: unknown, n: number) => void } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 1000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || (opts.retryable && !opts.retryable(e))) throw e;
      opts.onRetry?.(e, i);
      await sleep(base * 2 ** (i - 1));
    }
  }
}

/** Throttling, 5xx, timeouts and network errors are retryable; 4xx validation errors are not. */
export function isTransient(e: unknown): boolean {
  const err = e as { status?: number; $metadata?: { httpStatusCode?: number }; name?: string; code?: string };
  const status = err?.status ?? err?.$metadata?.httpStatusCode;
  if (typeof status === 'number') return status === 408 || status === 409 || status === 429 || status >= 500;
  const name = `${err?.name ?? ''} ${err?.code ?? ''}`;
  return /Throttl|Timeout|ServiceUnavailable|ECONNRESET|ETIMEDOUT|EAI_AGAIN|APIConnection|InternalServer|ModelNotReady/i.test(name);
}

/** A wall-clock budget that can be paused (time spent waiting for a human approval does not count). */
export class Deadline {
  private usedMs = 0;
  private since: number | null = Date.now();
  constructor(readonly budgetMs: number) {}
  pause() {
    if (this.since !== null) this.usedMs += Date.now() - this.since;
    this.since = null;
  }
  resume() {
    if (this.since === null) this.since = Date.now();
  }
  elapsedMs() {
    return this.usedMs + (this.since === null ? 0 : Date.now() - this.since);
  }
  remainingMs() {
    return this.budgetMs - this.elapsedMs();
  }
  expired() {
    return this.remainingMs() <= 0;
  }
}
