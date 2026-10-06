import { describe, expect, it } from 'vitest';
import { ceilToSlotMs, computeWindow, cooldownAfter, ledgerBounds, slotStartMs, WindowError, DEADLINE_MARGIN_MS, UPPER_HORIZON_MS } from '../src/escrow/time.js';
import { COOLDOWN_MS } from '../src/constants.js';

const TIP = 1_791_300_000_500n; // mid-slot on purpose

describe('ms <-> slot rounding (preprod 1 s slots)', () => {
  it('slotStart floors, ceil rounds up to the next slot start', () => {
    expect(slotStartMs(TIP)).toBe(1_791_300_000_000n);
    expect(ceilToSlotMs(TIP)).toBe(1_791_300_001_000n);
    expect(ceilToSlotMs(1_791_300_000_000n)).toBe(1_791_300_000_000n);
  });
  it('a lower bound rounded up always satisfies must_start_after(T)', () => {
    for (let k = 0; k < 2000; k++) {
      const T = 1_791_300_000_000n + BigInt(Math.floor(Math.random() * 10_000_000));
      expect(slotStartMs(ceilToSlotMs(T)) >= T).toBe(true);
    }
  });
});

describe('computeWindow', () => {
  it('defaults: lower = tip-60s (slot start), upper = tip+300s', () => {
    const w = computeWindow(TIP);
    expect(w.from).toBe(slotStartMs(TIP - 60_000n));
    expect(w.to).toBe(slotStartMs(TIP + UPPER_HORIZON_MS));
  });
  it('must_start_after in the future -> WindowError with the slot-rounded time to retry at', () => {
    const T = TIP + 10_123n;
    try {
      computeWindow(TIP, { notBefore: T });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WindowError);
      expect((e as WindowError).notBefore).toBe(ceilToSlotMs(T));
    }
  });
  it('must_start_after in the past -> lower >= T exactly as the ledger reports it', () => {
    const T = TIP - 1_234n;
    const w = computeWindow(TIP, { notBefore: T });
    expect(ledgerBounds(w).lower >= T).toBe(true);
  });
  it('must_end_before: ledger upper strictly before the deadline, with margin', () => {
    const D = TIP + 200_000n;
    const w = computeWindow(TIP, { endBefore: D });
    expect(ledgerBounds(w).upper < D).toBe(true);
    expect(w.to <= D - DEADLINE_MARGIN_MS).toBe(true);
  });
  it('deadline too close -> window closed', () => {
    expect(() => computeWindow(TIP, { endBefore: TIP + 100_000n })).toThrow(/window closed/);
    expect(() => computeWindow(TIP, { endBefore: TIP - 1n })).toThrow(WindowError);
  });
});

describe('cooldown', () => {
  it('written cooldown >= ledger upper + cooldown_period (420 s)', () => {
    expect(COOLDOWN_MS).toBe(420_000n);
    for (let k = 0; k < 500; k++) {
      const tip = TIP + BigInt(Math.floor(Math.random() * 1_000_000));
      const w = computeWindow(tip);
      expect(cooldownAfter(w) >= ledgerBounds(w).upper + COOLDOWN_MS).toBe(true);
    }
  });
  it('the same party can act again only after the cooldown it wrote', () => {
    const w = computeWindow(TIP);
    const cd = cooldownAfter(w);
    expect(() => computeWindow(TIP + 60_000n, { notBefore: cd })).toThrow(WindowError);
    const w2 = computeWindow(cd + 1_000n, { notBefore: cd });
    expect(ledgerBounds(w2).lower >= cd).toBe(true);
  });
});
