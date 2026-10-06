import { z } from 'zod';

/** The task spec a buyer hires us for (MIP-003 input_data). Its RFC 8785 SHA-256 is the buyer's input hash. */
export const TaskSpec = z
  .object({
    merchant: z.literal('skylane'),
    vigil: z.literal('flight_compensation').default('flight_compensation'),
    booking_ref: z.string().regex(/^[A-Z0-9]{6}$/, 'booking_ref must be 6 uppercase letters/digits'),
    passenger_name: z.string().trim().min(2).max(80),
    /** Cash payouts only: "Compensation paid" is the outcome we commit to (a voucher is a different outcome). */
    payout: z.enum(['original_card', 'bank_transfer']).default('original_card'),
    account_holder: z.string().trim().max(80).optional(),
    account_number: z.string().trim().regex(/^[A-Z0-9 ]{8,34}$/i).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.payout === 'bank_transfer' && (!v.account_holder || !v.account_number)) {
      ctx.addIssue({ code: 'custom', message: 'bank_transfer needs account_holder and account_number' });
    }
  });
export type TaskSpec = z.infer<typeof TaskSpec>;

export const JobBody = z
  .object({
    identifier_from_purchaser: z.string().regex(/^([0-9a-f]{2}){7,32}$/, 'identifier_from_purchaser must be 14-64 lowercase even-length hex'),
    input_data: TaskSpec,
  })
  .strict();
export type JobBody = z.infer<typeof JobBody>;

export type JobStatus =
  | 'awaiting_payment' // 402 paid, lock not yet seen on chain
  | 'locked' // lock seen and matches the signed terms
  | 'running' // browser session filing the claim
  | 'evidence_ready' // "Compensation paid" observed, bundle hashed, SubmitResult pending
  | 'result_submitted' // SubmitResult on chain, waiting for unlockTime
  | 'disputed' // buyer SetRefundRequested after our result
  | 'refund_authorized' // we ran AuthorizeRefund
  | 'collected' // Withdraw done
  | 'refunded' // escrow closed by the buyer's WithdrawRefund
  | 'failed';

/** What the escrow datum must say: exactly the terms we signed (bigints as decimal strings). */
export interface ExpectedLock {
  sellerAddress: string;
  referenceKey: string;
  referenceSignature: string;
  sellerNonce: string;
  buyerNonce: string;
  agentIdentifier: string;
  inputHash: string;
  payByTime: string;
  submitResultTime: string;
  unlockTime: string;
  externalDisputeUnlockTime: string;
  unit: string;
  amount: string;
  txHash: string;
}

export interface JobTerms {
  blockchainIdentifier: string;
  agentIdentifier: string | null;
  sellerVKey: string;
  sellerAddress: string;
  identifierFromPurchaser: string;
  /** The on-chain input_hash (x402 commitment digest). */
  onchainInputHash: string;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  amountLovelace: string;
}

export interface JobWork {
  mode: 'merchant-scripted' | 'specialist-builtin';
  browser: 'local' | 'agentcore';
  claimId: string | null;
  statusUrl: string | null;
  observedStatus: string | null;
  observedLabel: string | null;
  observedAt: string | null;
  amountCents: number | null;
  evidenceDir: string | null;
  manifestPath: string | null;
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  error: string | null;
  input: JobBody;
  /** SHA-256 hex of the canonical task spec (input_data). */
  inputHash: string;
  lockTx: string;
  expected: ExpectedLock;
  terms: JobTerms;
  lock: { txHash: string; outputIndex: number; lovelace: string } | null;
  work: JobWork | null;
  resultHash: string | null;
  resultTx: string | null;
  collectTx: string | null;
  refundAuthTx: string | null;
  closedBy: string | null;
  escrowState: string | null;
  events: Array<{ at: string; msg: string }>;
}

export const ACTIVE: JobStatus[] = ['awaiting_payment', 'locked', 'running', 'evidence_ready', 'result_submitted', 'disputed', 'refund_authorized'];

/** MIP-003 status vocabulary. */
export function mip003Status(s: JobStatus): 'awaiting_payment' | 'running' | 'completed' | 'failed' {
  if (s === 'awaiting_payment') return 'awaiting_payment';
  if (s === 'locked' || s === 'running' || s === 'evidence_ready') return 'running';
  if (s === 'failed') return 'failed';
  return 'completed';
}
