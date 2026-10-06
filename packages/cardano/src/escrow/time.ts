/**
 * Validity-window and cooldown maths for vested_pay v2 (docs/research/vested-pay-v2.md §6 "Slot rounding", §8, §9).
 *
 * Evolution converts a POSIX-ms bound to a slot with floor division; the ledger then shows scripts
 * lower = slotStart(fromSlot) and upper = slotStart(ttlSlot). Preprod: 1 s slots, zeroTime 1655769600000.
 *  - must_start_after(T)  (T <= lower):  pass from = ceilToSlot(T), and only submit once chain time >= from.
 *  - must_end_before(T)   (upper < T):   pass any `to` with slotStart(to) < T (we keep a margin).
 *  - cooldown fields:     write >= slotStart(to) + cooldown_period (+1 s pad, as Masumi does).
 * The ledger accepts the tx only while tip ∈ [fromSlot, ttlSlot). All times here are chain time, never local clock.
 */
import { SlotConfig, Time } from '@evolution-sdk/evolution';
import { COOLDOWN_MS } from '../constants.js';

export const SLOT_CONFIG = SlotConfig.SLOT_CONFIG_NETWORK.Preprod;
const SLOT_MS = BigInt(SLOT_CONFIG.slotLength);

/** POSIX ms the ledger reports to scripts for a bound `ms`: the start of the enclosing slot. */
export const slotStartMs = (ms: bigint): bigint => Time.slotToUnixTime(Time.unixTimeToSlot(ms, SLOT_CONFIG), SLOT_CONFIG);
/** First slot start at or after `ms`. */
export const ceilToSlotMs = (ms: bigint): bigint => {
  const s = slotStartMs(ms);
  return s === ms ? ms : s + SLOT_MS;
};
export const msToSlot = (ms: bigint): bigint => Time.unixTimeToSlot(ms, SLOT_CONFIG);

/** Look-back for the lower bound when nothing constrains it (keeps the tx valid despite tip lag). */
export const LOWER_SLACK_MS = 60_000n;
/** Normal TTL horizon. */
export const UPPER_HORIZON_MS = 300_000n;
/** Distance kept from a must_end_before deadline (CF demo uses 120 s; Masumi uses 18 slots). */
export const DEADLINE_MARGIN_MS = 120_000n;
/** A window must leave at least this long to land the tx before `to`. */
export const MIN_LANDING_MS = 30_000n;
/** Masumi pads the written cooldown by 1 s beyond upper + cooldown_period. */
export const COOLDOWN_PAD_MS = 1_000n;

export interface Window {
  from: bigint;
  to: bigint;
}

export class WindowError extends Error {
  constructor(
    message: string,
    /** When set, the action becomes possible at this chain time (ms); retry then. */
    readonly notBefore?: bigint,
  ) {
    super(message);
    this.name = 'WindowError';
  }
}

const max = (...xs: bigint[]) => xs.reduce((a, b) => (a > b ? a : b));
const min = (...xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b));

/**
 * Compute a validity window at chain time `tipMs`.
 * @param notBefore validator lower bound requirement (T <= lower), if any
 * @param endBefore validator strict upper bound requirement (upper < T), if any
 */
export function computeWindow(tipMs: bigint, opts: { notBefore?: bigint; endBefore?: bigint; margin?: bigint } = {}): Window {
  const lowerReq = opts.notBefore !== undefined && opts.notBefore > 0n ? ceilToSlotMs(opts.notBefore) : 0n;
  const from = max(slotStartMs(tipMs - LOWER_SLACK_MS), lowerReq);
  if (from > tipMs) throw new WindowError(`not valid before ${from} (chain time ${tipMs})`, from);
  let to = tipMs + UPPER_HORIZON_MS;
  if (opts.endBefore !== undefined) to = min(to, opts.endBefore - (opts.margin ?? DEADLINE_MARGIN_MS));
  to = slotStartMs(to);
  if (opts.endBefore !== undefined && !(to < opts.endBefore)) throw new WindowError('upper bound not before deadline');
  if (to <= tipMs + MIN_LANDING_MS || to <= from) throw new WindowError(`window closed: deadline ${opts.endBefore} too close to chain time ${tipMs}`);
  return { from, to };
}

/** The cooldown value to write: >= slotStart(upper) + cooldown_period (validator: new_cd >= upper + cooldown). */
export const cooldownAfter = (w: Window, cooldownMs: bigint = COOLDOWN_MS): bigint => slotStartMs(w.to) + cooldownMs + COOLDOWN_PAD_MS;

/** What the validator would check, recomputed from the bounds the ledger will report. For tests and preflight. */
export const ledgerBounds = (w: Window) => ({ lower: slotStartMs(w.from), upper: slotStartMs(w.to) });
