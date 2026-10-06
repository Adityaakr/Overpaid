import { z } from 'zod';

// Money is always integer minor units (cents) plus an ISO currency code.
export const Money = z.object({ amount: z.number().int(), currency: z.string().length(3) });
export type Money = z.infer<typeof Money>;

export const VIGIL_TYPES = [
  'forgotten_subscription',
  'duplicate_charge',
  'price_drop',
  'undelivered_order',
  'flight_compensation',
  'bill_above_market',
] as const;
export const VigilType = z.enum(VIGIL_TYPES);
export type VigilType = z.infer<typeof VigilType>;

export const VIGIL_LABEL: Record<VigilType, string> = {
  forgotten_subscription: 'Forgotten subscription',
  duplicate_charge: 'Duplicate charge',
  price_drop: 'Price drop',
  undelivered_order: 'Undelivered order',
  flight_compensation: 'Flight delay compensation',
  bill_above_market: 'Bill above market',
};

export const SourceKind = z.enum(['email', 'statement']);

export const Transaction = z.object({
  id: z.string(),
  sourceId: z.string(),
  merchant: z.string(),
  descriptor: z.string(),
  amount: z.number().int(),
  currency: z.string().length(3),
  date: z.string(), // ISO date
  orderId: z.string().nullable(),
});
export type Transaction = z.infer<typeof Transaction>;

export const OpportunityStatus = z.enum(['open', 'queued', 'in_progress', 'recovered', 'failed', 'dismissed']);
export const Opportunity = z.object({
  id: z.string(),
  vigilType: VigilType,
  merchant: z.string(),
  valueEstimate: z.number().int(),
  currency: z.string().length(3),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  sourceRecordIds: z.array(z.string()),
  status: OpportunityStatus,
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const TASK_STATES = [
  'queued',
  'running',
  'needs_approval',
  'needs_specialist',
  'hired',
  'done',
  'refunded',
  'disputed',
  'failed',
] as const;
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

// Allowed transitions of the task state machine (docs/BRIEF.md "Task state machine").
export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  queued: ['running', 'failed'],
  running: ['needs_approval', 'needs_specialist', 'done', 'failed'],
  needs_approval: ['running', 'failed'],
  needs_specialist: ['hired', 'failed'],
  hired: ['done', 'refunded', 'disputed', 'failed'],
  done: [],
  refunded: [],
  disputed: ['done', 'refunded'],
  failed: ['queued'],
};
export function canTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const TaskMode = z.enum(['agent', 'scripted']);
export type TaskMode = z.infer<typeof TaskMode>;

export const Task = z.object({
  id: z.string(),
  opportunityId: z.string(),
  state: TaskState,
  sessionId: z.string().nullable(),
  recipeId: z.string(),
  mode: TaskMode,
  step: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

export const EscrowState = z.enum([
  'quoted',
  'FundsLocked',
  'ResultSubmitted',
  'RefundRequested',
  'Disputed',
  'WithdrawAuthorized',
  'RefundAuthorized',
  'Withdrawn',
  'RefundWithdrawn',
]);
export type EscrowState = z.infer<typeof EscrowState>;
