import { bigint, boolean, integer, jsonb, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Data model from docs/BRIEF.md "Data model (Postgres)". Money columns are integer minor units.
const ts = (name: string) => timestamp(name, { withTimezone: true });
const created = () => ts('created_at').defaultNow().notNull();

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // email | statement
  filename: text('filename').notNull(),
  parsedAt: ts('parsed_at').defaultNow().notNull(),
  demo: boolean('demo').notNull().default(true),
});

export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  merchant: text('merchant').notNull(),
  descriptor: text('descriptor').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  date: text('date').notNull(),
  orderId: text('order_id'),
  kind: text('kind').notNull().default('charge'), // charge | refund | receipt
  meta: jsonb('meta').notNull().default({}),
});

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  merchant: text('merchant').notNull(),
  plan: text('plan').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  cadence: text('cadence').notNull(), // monthly | yearly | weekly
  nextRenewal: text('next_renewal'),
  lastUseSignal: text('last_use_signal'),
});

export const opportunities = pgTable('opportunities', {
  id: text('id').primaryKey(),
  vigilType: text('vigil_type').notNull(),
  merchant: text('merchant').notNull(),
  valueEstimate: integer('value_estimate').notNull(),
  currency: text('currency').notNull().default('USD'),
  confidence: real('confidence').notNull(),
  reason: text('reason').notNull(),
  sourceRecordIds: jsonb('source_record_ids').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('open'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  opportunityId: text('opportunity_id').notNull(),
  state: text('state').notNull().default('queued'),
  sessionId: text('session_id'),
  recipeId: text('recipe_id').notNull(),
  mode: text('mode').notNull().default('agent'),
  step: text('step'),
  failureReason: text('failure_reason'),
  liveViewUrl: text('live_view_url'),
  costCents: real('cost_cents').notNull().default(0),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  createdAt: created(),
});

export const approvals = pgTable('approvals', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  step: text('step').notNull(),
  reason: text('reason').notNull(),
  state: text('state').notNull().default('pending'), // pending | approved | rejected
  screenshot: text('screenshot'),
  decidedAt: ts('decided_at'),
  createdAt: created(),
});

export const evidence = pgTable('evidence', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().unique(),
  manifestPath: text('manifest_path').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: created(),
});

export const recoveries = pgTable('recoveries', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().unique(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  confirmedAt: ts('confirmed_at').defaultNow().notNull(),
});

export const specialists = pgTable('specialists', {
  id: text('id').primaryKey(),
  masumiAgentId: text('masumi_agent_id'),
  name: text('name').notNull(),
  capability: text('capability').notNull(),
  url: text('url').notNull(),
  feeLovelace: bigint('fee_lovelace', { mode: 'number' }),
  feeAsset: text('fee_asset'),
  feeAmount: bigint('fee_amount', { mode: 'number' }),
  firstParty: boolean('first_party').notNull().default(true),
  completed: integer('completed').notNull().default(0),
  refunded: integer('refunded').notNull().default(0),
  disputed: integer('disputed').notNull().default(0),
});

export const hires = pgTable('hires', {
  id: text('id').primaryKey(),
  taskId: text('task_id'),
  specialistId: text('specialist_id').notNull(),
  jobId: text('job_id'),
  blockchainIdentifier: text('blockchain_identifier'),
  inputHash: text('input_hash'),
  resultHash: text('result_hash'),
  escrowState: text('escrow_state').notNull().default('quoted'),
  payBy: ts('pay_by'),
  submitResultBy: ts('submit_result_by'),
  unlockAt: ts('unlock_at'),
  disputeUnlockAt: ts('dispute_unlock_at'),
  txLock: text('tx_lock'),
  txResult: text('tx_result'),
  txCollect: text('tx_collect'),
  txRefund: text('tx_refund'),
  longTimer: boolean('long_timer').notNull().default(false),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});

export const blocs = pgTable('blocs', {
  id: text('id').primaryKey(),
  campaignNft: text('campaign_nft'),
  campaignUtxo: text('campaign_utxo'),
  item: text('item').notNull(),
  itemHash: text('item_hash'),
  membersLimit: integer('members_limit').notNull(),
  minGroupSize: integer('min_group_size').notNull(),
  bidDeadline: ts('bid_deadline'),
  refundDeadline: ts('refund_deadline'),
  providerAllowlist: jsonb('provider_allowlist').$type<string[]>().notNull().default([]),
  state: text('state').notNull().default('open'),
  currentPriceCents: integer('current_price_cents'),
  createdAt: created(),
});

export const pledges = pgTable('pledges', {
  id: text('id').primaryKey(),
  blocId: text('bloc_id').notNull(),
  memberLabel: text('member_label').notNull(),
  walletAddress: text('wallet_address').notNull(),
  utxoRef: text('utxo_ref'),
  quantity: integer('quantity').notNull().default(1),
  maxUnitPrice: bigint('max_unit_price', { mode: 'number' }).notNull(),
  lockedAmount: bigint('locked_amount', { mode: 'number' }).notNull(),
  simulated: boolean('simulated').notNull().default(false),
  state: text('state').notNull().default('pending'),
  txHash: text('tx_hash'),
  createdAt: created(),
});

export const bids = pgTable('bids', {
  id: text('id').primaryKey(),
  blocId: text('bloc_id').notNull(),
  provider: text('provider').notNull(),
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  expiry: ts('expiry').notNull(),
  providerAddress: text('provider_address').notNull(),
  providerVkey: text('provider_vkey').notNull(),
  signature: text('signature').notNull(),
  valid: boolean('valid').notNull().default(false),
  strategy: text('strategy'),
  createdAt: created(),
});

export const settlements = pgTable('settlements', {
  id: text('id').primaryKey(),
  blocId: text('bloc_id').notNull(),
  txHash: text('tx_hash'),
  pledgeCount: integer('pledge_count').notNull(),
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  createdAt: created(),
});

export const metrics = pgTable('metrics', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').defaultNow().notNull(),
});

// Append-only event log, replayed to SSE clients on connect.
export const events = pgTable('events', {
  seq: serial('seq').primaryKey(),
  type: text('type').notNull(),
  data: jsonb('data').notNull(),
  at: ts('at').defaultNow().notNull(),
});

// Idempotency keys for jobs, pledges and settlements.
export const idempotency = pgTable('idempotency', {
  key: text('key').primaryKey(),
  result: jsonb('result'),
  createdAt: created(),
});

// Success fees: paid by the user from their own wallet, only after a recovery is confirmed.
export const fees = pgTable('fees', {
  id: text('id').primaryKey(),
  recoveryId: text('recovery_id').notNull().unique(),
  lovelace: bigint('lovelace', { mode: 'number' }).notNull(),
  payerAddress: text('payer_address'),
  payTo: text('pay_to').notNull(),
  txHash: text('tx_hash'),
  state: text('state').notNull().default('unpaid'), // unpaid | submitted | paid
  createdAt: created(),
  paidAt: ts('paid_at'),
});
