/**
 * Room join tokens: one-time, per-IP rate limited, and capped (docs/BRIEF.md <agents> "Room pledgers": one QR scan
 * can't drain the wallets; cap 150). Also assigns room wallets room-001..room-150 in order.
 */
import { randomBytes } from 'node:crypto';
import { MEMBERS_CAP } from './units.js';

export interface JoinTokenOptions {
  cap?: number;
  /** Max join attempts per IP inside `windowMs`. */
  perIp?: number;
  windowMs?: number;
  now?: () => number;
}

export type ConsumeResult =
  | { ok: true; slot: number; wallet: string }
  | { ok: false; status: 400 | 403 | 409 | 429; error: string };

export const roomWalletName = (slot: number) => `room-${String(slot).padStart(3, '0')}`;

export class JoinTokens {
  private readonly tokens = new Map<string, { used: boolean; createdAt: number }>();
  private readonly hits = new Map<string, number[]>();
  private nextSlot = 1;
  readonly cap: number;
  private readonly perIp: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(o: JoinTokenOptions = {}) {
    this.cap = o.cap ?? MEMBERS_CAP;
    this.perIp = o.perIp ?? 3;
    this.windowMs = o.windowMs ?? 10 * 60_000;
    this.now = o.now ?? Date.now;
  }

  issue(count = 1): string[] {
    const out: string[] = [];
    for (let i = 0; i < Math.max(0, Math.min(count, 500)); i++) {
      const t = randomBytes(12).toString('base64url');
      this.tokens.set(t, { used: false, createdAt: this.now() });
      out.push(t);
    }
    return out;
  }

  /** An unused token (for the QR on the big screen), issuing one if none is left. */
  current(): string {
    for (const [t, s] of this.tokens) if (!s.used) return t;
    return this.issue(1)[0]!;
  }

  get used(): number {
    return this.nextSlot - 1;
  }
  get remaining(): number {
    return Math.max(0, this.cap - this.used);
  }

  /** Per-IP sliding-window limiter; counts every attempt (valid or not). */
  private allow(ip: string): boolean {
    const t = this.now();
    const xs = (this.hits.get(ip) ?? []).filter((x) => t - x < this.windowMs);
    if (xs.length >= this.perIp) {
      this.hits.set(ip, xs);
      return false;
    }
    xs.push(t);
    this.hits.set(ip, xs);
    return true;
  }

  consume(token: string | undefined, ip: string): ConsumeResult {
    if (!this.allow(ip)) return { ok: false, status: 429, error: 'too many join attempts from this device; try again later' };
    if (!token) return { ok: false, status: 400, error: 'missing join token' };
    const s = this.tokens.get(token);
    if (!s) return { ok: false, status: 403, error: 'unknown join token' };
    if (s.used) return { ok: false, status: 409, error: 'this join link was already used' };
    if (this.nextSlot > this.cap) return { ok: false, status: 409, error: `the room is full (${this.cap} members)` };
    s.used = true;
    const slot = this.nextSlot++;
    return { ok: true, slot, wallet: roomWalletName(slot) };
  }

  /** Give a slot back after a failed pledge (the token stays spent). */
  release(slot: number): void {
    if (slot === this.nextSlot - 1) this.nextSlot--;
  }
}
