/**
 * Pure decision logic for specialist hires (vested_pay v2 escrow lifecycle, docs/ARCHITECTURE.md). Kept free of
 * I/O so followHires and the routes stay thin and the rules are unit-tested.
 */

/** Hire states followHires keeps watching. `settlement_pending`: lock tx signed and persisted, settlement unconfirmed. */
export const ACTIVE_HIRE_STATES = [
  'quoted', 'settlement_pending', 'FundsLocked', 'ResultSubmitted', 'RefundRequested', 'Disputed', 'RefundAuthorized', 'WithdrawAuthorized',
];
export const TERMINAL_HIRE_STATES = ['Withdrawn', 'RefundWithdrawn', 'failed'];

/** Specialist job status -> escrow state (vested_pay v2 states, plus closed outcomes). Job `failed` is a work failure, not an escrow state. */
export const ESCROW_FROM_JOB: Record<string, string> = {
  awaiting_payment: 'FundsLocked',
  locked: 'FundsLocked',
  running: 'FundsLocked',
  evidence_ready: 'FundsLocked',
  result_submitted: 'ResultSubmitted',
  disputed: 'Disputed',
  refund_authorized: 'RefundAuthorized',
  collected: 'Withdrawn',
  refunded: 'RefundWithdrawn',
};

// Progress rank. A hire only ever moves to a strictly higher rank, so it never maps backwards (e.g. out of
// RefundRequested/Disputed/RefundAuthorized because a lagging job or chain read still says FundsLocked/ResultSubmitted).
const RANK: Record<string, number> = {
  quoted: 0,
  settlement_pending: 1,
  FundsLocked: 2,
  ResultSubmitted: 3,
  RefundRequested: 4,
  Disputed: 5,
  RefundAuthorized: 6,
  WithdrawAuthorized: 6,
  Withdrawn: 9,
  RefundWithdrawn: 9,
};

/** Next tracked state given a candidate (from the job or the chain). */
export function nextHireState(current: string, candidate: string | null | undefined): string {
  if (!candidate || candidate === current) return current;
  if (TERMINAL_HIRE_STATES.includes(current)) return current;
  if (candidate === 'failed') return RANK[current]! <= RANK.settlement_pending! ? 'failed' : current; // money locked: keep tracking
  const a = RANK[current];
  const b = RANK[candidate];
  if (a === undefined) return b === undefined ? current : candidate;
  if (b === undefined) return current;
  return b > a ? candidate : current;
}

/** Minimal view of `escrowStatus()` from @overpaid/cardano. */
export type ChainView =
  | { status: 'not_found' }
  | { status: 'open'; state: string; resultHash: string }
  | { status: 'closed'; closedBy: string; lastState: string };

/** Map an on-chain escrow read to a tracked state (null = cannot tell). */
export function stateFromChain(c: ChainView, known: { txRefund?: string | null; txCollect?: string | null }): string | null {
  if (c.status === 'not_found') return null;
  if (c.status === 'open') return c.state;
  if (known.txRefund && c.closedBy === known.txRefund) return 'RefundWithdrawn';
  if (known.txCollect && c.closedBy === known.txCollect) return 'Withdrawn';
  if (['RefundAuthorized', 'RefundRequested', 'FundsLocked'].includes(c.lastState)) return 'RefundWithdrawn';
  if (['ResultSubmitted', 'WithdrawAuthorized'].includes(c.lastState)) return 'Withdrawn';
  return null;
}

/**
 * Should the buyer submit WithdrawRefund now? Yes when the escrow is RefundAuthorized, or it is RefundRequested /
 * FundsLocked with no result hash and chain time is past submitResultTime (the specialist never delivered).
 */
export function shouldWithdrawRefund(c: ChainView, submitResultBy: Date | null, now: number, pending?: { txRefund?: string | null; submittedAt?: number | null }): boolean {
  if (c.status !== 'open') return false;
  if (pending?.submittedAt && now - pending.submittedAt < 5 * 60_000) return false; // a withdraw is already in flight
  if (c.state === 'RefundAuthorized') return true;
  if ((c.state === 'RefundRequested' || c.state === 'FundsLocked') && c.resultHash === '' && submitResultBy) return now > submitResultBy.getTime();
  return false;
}

export const AUTO_DISPUTE_WINDOW_MS = 3 * 60_000;

/** Retry verification every loop while not verified and before unlock. */
export function shouldVerify(h: { verified: unknown; resultHash: string | null; unlockAt: Date | null; state: string }, now: number): boolean {
  if (h.verified === true || !h.resultHash || !h.unlockAt) return false;
  if (!['FundsLocked', 'ResultSubmitted'].includes(h.state)) return false;
  return now < h.unlockAt.getTime();
}

/** Still unverified within 3 minutes of unlock (and before it): dispute automatically, once. */
export function shouldAutoDispute(h: { verified: unknown; resultHash: string | null; unlockAt: Date | null; state: string; autoDisputed?: unknown }, now: number): boolean {
  if (h.verified === true || h.autoDisputed || !h.resultHash || !h.unlockAt) return false;
  if (h.state !== 'ResultSubmitted') return false;
  const unlock = h.unlockAt.getTime();
  return now < unlock && now >= unlock - AUTO_DISPUTE_WINDOW_MS;
}

/** Manual dispute is allowed only from an open, non-refund state and before unlockTime. Returns an error message or null. */
export function disputeBlocked(h: { state: string; txLock: string | null; unlockAt: Date | null }, now: number): string | null {
  if (!h.txLock) return 'hire has no lock tx';
  if (!['FundsLocked', 'ResultSubmitted'].includes(h.state)) return `cannot dispute a hire in state ${h.state}`;
  if (!h.unlockAt || now >= h.unlockAt.getTime()) return 'unlock time has passed; the dispute window is closed';
  return null;
}

/** 409 guard: a task may have at most one hire in an active escrow state. */
export function activeHireFor(rows: Array<{ id: string; taskId: string | null; escrowState: string }>, taskId: string): string | null {
  return rows.find((r) => r.taskId === taskId && ACTIVE_HIRE_STATES.includes(r.escrowState))?.id ?? null;
}

/** Task/opportunity effect of a hire state transition (null = no change). */
export function taskEffect(state: string): { task: string; step: string; opportunity: string } | null {
  if (state === 'Disputed') return { task: 'disputed', step: 'Dispute open on the escrow', opportunity: 'in_progress' };
  if (state === 'RefundWithdrawn') return { task: 'needs_specialist', step: 'Refunded, re-hire available', opportunity: 'queued' };
  if (state === 'failed') return { task: 'failed', step: 'Specialist hire failed', opportunity: 'failed' };
  return null;
}
