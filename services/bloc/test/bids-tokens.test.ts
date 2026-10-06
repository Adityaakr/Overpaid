import { describe, expect, it } from 'vitest';
import { signBid } from '@overpaid/bloc-contract';
import { checkBid } from '../src/planner.js';
import { JoinTokens } from '../src/tokens.js';
import { bidFromWire, bidToWire } from '../src/wire.js';
import { CAMPAIGN, NOW, POLICY, SK, bidFor, hexOf } from './fixtures.js';

describe('bid verification', () => {
  it('accepts an allowlisted, unexpired, correctly signed bid (and survives the JSON wire round trip)', () => {
    const b = bidFor(1, 1_500_000n);
    expect(checkBid(CAMPAIGN, b, NOW)).toEqual({ valid: true });
    const wire = JSON.parse(JSON.stringify(bidToWire(b.bid)));
    expect(checkBid(CAMPAIGN, { bid: bidFromWire(wire), signature: b.signature }, NOW)).toEqual({ valid: true });
  });
  it('rejects a signature from the wrong key', () => {
    const b = bidFor(1, 1_500_000n);
    const forged = signBid(SK[0]!, POLICY.hash, { ...b.bid, providerVkey: bidFor(0, 1n).bid.providerVkey });
    expect(checkBid(CAMPAIGN, { bid: b.bid, signature: forged }, NOW)).toEqual({ valid: false, reason: 'bad signature' });
    expect(checkBid(CAMPAIGN, { bid: { ...b.bid, unitPrice: 1_000_000n }, signature: b.signature }, NOW)).toEqual({ valid: false, reason: 'bad signature' });
  });
  it('rejects an expired bid and bids after the deadline', () => {
    const b = bidFor(0, 1_500_000n, { expiry: NOW - 1n });
    expect(checkBid(CAMPAIGN, b, NOW)).toEqual({ valid: false, reason: 'bid expired' });
    const late = bidFor(0, 1_500_000n, { expiry: CAMPAIGN.bidDeadline + 10_000_000n });
    expect(checkBid(CAMPAIGN, late, CAMPAIGN.bidDeadline)).toEqual({ valid: false, reason: 'bid deadline passed' });
  });
  it('rejects a non-allowlisted provider and bids for another campaign', () => {
    expect(checkBid(CAMPAIGN, bidFor(3, 1_500_000n), NOW)).toEqual({ valid: false, reason: 'provider key is not in the campaign allowlist' });
    expect(checkBid(CAMPAIGN, bidFor(0, 1_500_000n, { blocId: hexOf('other') }), NOW)).toMatchObject({ valid: false, reason: 'bid is for another bloc' });
    expect(checkBid({ ...CAMPAIGN, policyId: 'c0'.repeat(28) }, bidFor(0, 1_500_000n), NOW)).toEqual({ valid: false, reason: 'bad signature' });
  });
  it('rejects malformed wire bids', () => {
    const w = bidToWire(bidFor(0, 1n).bid);
    expect(() => bidFromWire({ ...w, unitPrice: '-5' })).toThrow();
    expect(() => bidFromWire({ ...w, providerVkey: 'zz' })).toThrow();
  });
});

describe('join tokens', () => {
  it('are one-time', () => {
    const t = new JoinTokens();
    const [a] = t.issue(1);
    expect(t.consume(a, '1.1.1.1')).toEqual({ ok: true, slot: 1, wallet: 'room-001' });
    expect(t.consume(a, '1.1.1.2')).toMatchObject({ ok: false, status: 409 });
    expect(t.consume('nope', '1.1.1.3')).toMatchObject({ ok: false, status: 403 });
    expect(t.consume(undefined, '1.1.1.3')).toMatchObject({ ok: false, status: 400 });
  });
  it('rate-limit per IP within the window', () => {
    let now = 0;
    const t = new JoinTokens({ perIp: 2, windowMs: 1000, now: () => now });
    const toks = t.issue(5);
    expect(t.consume(toks[0], 'ip').ok).toBe(true);
    expect(t.consume(toks[1], 'ip').ok).toBe(true);
    expect(t.consume(toks[2], 'ip')).toMatchObject({ ok: false, status: 429 });
    expect(t.consume(toks[2], 'other').ok).toBe(true);
    now = 1500;
    expect(t.consume(toks[3], 'ip')).toMatchObject({ ok: true, wallet: 'room-004' });
  });
  it('cap the room', () => {
    const t = new JoinTokens({ cap: 2, perIp: 100 });
    const toks = t.issue(3);
    expect(t.consume(toks[0], 'a').ok).toBe(true);
    expect(t.consume(toks[1], 'a').ok).toBe(true);
    expect(t.consume(toks[2], 'a')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/full/) });
    expect(t.remaining).toBe(0);
    expect(new JoinTokens().cap).toBe(150);
  });
});
