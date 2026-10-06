import { describe, expect, it } from 'vitest';
import { serial } from '@overpaid/cardano';
import {
  activeHireFor, disputeBlocked, nextHireState, shouldAutoDispute, shouldVerify, shouldWithdrawRefund, stateFromChain, taskEffect,
} from '../src/hireLogic.js';

const T0 = 1_800_000_000_000;
const min = 60_000;

describe('nextHireState: never maps backwards', () => {
  it('moves forward along the happy path', () => {
    expect(nextHireState('settlement_pending', 'FundsLocked')).toBe('FundsLocked');
    expect(nextHireState('FundsLocked', 'ResultSubmitted')).toBe('ResultSubmitted');
    expect(nextHireState('ResultSubmitted', 'Withdrawn')).toBe('Withdrawn');
  });
  it('never leaves RefundRequested / Disputed / RefundAuthorized for an earlier state', () => {
    for (const s of ['RefundRequested', 'Disputed', 'RefundAuthorized']) {
      for (const back of ['FundsLocked', 'ResultSubmitted', 'settlement_pending', 'quoted']) expect(nextHireState(s, back)).toBe(s);
    }
    expect(nextHireState('Disputed', 'RefundRequested')).toBe('Disputed');
    expect(nextHireState('RefundRequested', 'Disputed')).toBe('Disputed');
    expect(nextHireState('Disputed', 'RefundAuthorized')).toBe('RefundAuthorized');
    expect(nextHireState('RefundAuthorized', 'RefundWithdrawn')).toBe('RefundWithdrawn');
  });
  it('terminal states are final; job failure never drops a funded escrow', () => {
    expect(nextHireState('Withdrawn', 'FundsLocked')).toBe('Withdrawn');
    expect(nextHireState('RefundWithdrawn', 'Disputed')).toBe('RefundWithdrawn');
    expect(nextHireState('FundsLocked', 'failed')).toBe('FundsLocked');
    expect(nextHireState('settlement_pending', 'failed')).toBe('failed');
    expect(nextHireState('FundsLocked', undefined)).toBe('FundsLocked');
  });
});

describe('stateFromChain', () => {
  it('maps open and closed escrows', () => {
    expect(stateFromChain({ status: 'not_found' }, {})).toBeNull();
    expect(stateFromChain({ status: 'open', state: 'Disputed', resultHash: 'ab' }, {})).toBe('Disputed');
    expect(stateFromChain({ status: 'closed', closedBy: 'tx1', lastState: 'ResultSubmitted' }, { txRefund: 'tx1' })).toBe('RefundWithdrawn');
    expect(stateFromChain({ status: 'closed', closedBy: 'tx2', lastState: 'RefundAuthorized' }, {})).toBe('RefundWithdrawn');
    expect(stateFromChain({ status: 'closed', closedBy: 'tx2', lastState: 'ResultSubmitted' }, {})).toBe('Withdrawn');
    expect(stateFromChain({ status: 'closed', closedBy: 'tx2', lastState: 'Disputed' }, {})).toBeNull();
  });
});

describe('shouldWithdrawRefund (auto-withdraw)', () => {
  const by = new Date(T0);
  it('withdraws from RefundAuthorized at any time', () => {
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundAuthorized', resultHash: '' }, by, T0 - 30 * min)).toBe(true);
  });
  it('withdraws RefundRequested / FundsLocked with no result only after submitResultTime', () => {
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundRequested', resultHash: '' }, by, T0 - 1)).toBe(false);
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundRequested', resultHash: '' }, by, T0 + 1)).toBe(true);
    expect(shouldWithdrawRefund({ status: 'open', state: 'FundsLocked', resultHash: '' }, by, T0 + 1)).toBe(true);
  });
  it('never withdraws with a result hash, from other states, closed escrows, or while one is in flight', () => {
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundRequested', resultHash: 'ab' }, by, T0 + min)).toBe(false);
    expect(shouldWithdrawRefund({ status: 'open', state: 'Disputed', resultHash: 'ab' }, by, T0 + min)).toBe(false);
    expect(shouldWithdrawRefund({ status: 'open', state: 'ResultSubmitted', resultHash: 'ab' }, by, T0 + min)).toBe(false);
    expect(shouldWithdrawRefund({ status: 'closed', closedBy: 'x', lastState: 'RefundAuthorized' }, by, T0 + min)).toBe(false);
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundAuthorized', resultHash: '' }, by, T0, { submittedAt: T0 - min })).toBe(false);
    expect(shouldWithdrawRefund({ status: 'open', state: 'RefundAuthorized', resultHash: '' }, by, T0, { submittedAt: T0 - 6 * min })).toBe(true);
  });
});

describe('verification retry and auto-dispute', () => {
  const unlockAt = new Date(T0);
  const base = { resultHash: 'ab'.repeat(32), unlockAt, state: 'ResultSubmitted' };
  it('retries while unverified and before unlock, stops once verified or after unlock', () => {
    expect(shouldVerify({ ...base, verified: undefined }, T0 - 30 * min)).toBe(true);
    expect(shouldVerify({ ...base, verified: false }, T0 - 1)).toBe(true);
    expect(shouldVerify({ ...base, verified: true }, T0 - 30 * min)).toBe(false);
    expect(shouldVerify({ ...base, verified: false }, T0)).toBe(false);
    expect(shouldVerify({ ...base, resultHash: null, verified: false }, T0 - min)).toBe(false);
    expect(shouldVerify({ ...base, state: 'Disputed', verified: false }, T0 - min)).toBe(false);
  });
  it('auto-disputes only inside the last 3 minutes before unlock, once', () => {
    expect(shouldAutoDispute({ ...base, verified: false }, T0 - 4 * min)).toBe(false);
    expect(shouldAutoDispute({ ...base, verified: false }, T0 - 3 * min)).toBe(true);
    expect(shouldAutoDispute({ ...base, verified: undefined }, T0 - 1)).toBe(true);
    expect(shouldAutoDispute({ ...base, verified: false }, T0)).toBe(false);
    expect(shouldAutoDispute({ ...base, verified: true }, T0 - min)).toBe(false);
    expect(shouldAutoDispute({ ...base, verified: false, autoDisputed: true }, T0 - min)).toBe(false);
    expect(shouldAutoDispute({ ...base, verified: false, state: 'FundsLocked' }, T0 - min)).toBe(false);
  });
  it('manual dispute checks state and unlock time', () => {
    expect(disputeBlocked({ state: 'ResultSubmitted', txLock: 'tx', unlockAt }, T0 - min)).toBeNull();
    expect(disputeBlocked({ state: 'ResultSubmitted', txLock: 'tx', unlockAt }, T0)).toMatch(/unlock/);
    expect(disputeBlocked({ state: 'Disputed', txLock: 'tx', unlockAt }, T0 - min)).toMatch(/state/);
    expect(disputeBlocked({ state: 'FundsLocked', txLock: null, unlockAt }, T0 - min)).toMatch(/lock/);
  });
});

describe('concurrency guard', () => {
  it('refuses a second hire for a task that has an active one', () => {
    const rows = [
      { id: 'h1', taskId: 't1', escrowState: 'RefundWithdrawn' },
      { id: 'h2', taskId: 't1', escrowState: 'settlement_pending' },
      { id: 'h3', taskId: 't2', escrowState: 'failed' },
    ];
    expect(activeHireFor(rows, 't1')).toBe('h2');
    expect(activeHireFor(rows, 't2')).toBeNull();
  });
  it('serial(buyer) never overlaps two hires on the same wallet, even when one fails', async () => {
    let running = 0;
    let maxRunning = 0;
    const order: string[] = [];
    const hire = (name: string, fail = false) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end ${name}`);
      running--;
      if (fail) throw new Error('boom');
      return name;
    };
    const rs = await Promise.allSettled([serial('addr_buyer', hire('a', true)), serial('addr_buyer', hire('b')), serial('addr_buyer', hire('c'))]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(rs.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });
  it('maps outcomes onto the task', () => {
    expect(taskEffect('Disputed')?.task).toBe('disputed');
    expect(taskEffect('RefundWithdrawn')).toMatchObject({ task: 'needs_specialist', step: 'Refunded, re-hire available' });
    expect(taskEffect('failed')?.task).toBe('failed');
    expect(taskEffect('ResultSubmitted')).toBeNull();
  });
});
