import { z } from 'zod';

// SSE event names (docs/BRIEF.md "Events (SSE)").
export const EVENT_TYPES = [
  'task.updated',
  'approval.requested',
  'money.found',
  'money.recovered',
  'escrow.updated',
  'bloc.pledged',
  'bloc.bid',
  'bloc.settled',
  'metrics.updated',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export type OverpaidEvent = { type: EventType; at: string; data: Record<string, unknown> };

export function makeEvent(type: EventType, data: Record<string, unknown>): OverpaidEvent {
  return { type, at: new Date().toISOString(), data };
}

// Metrics shown in the always-visible metrics bar.
export const METRIC_KEYS = [
  'found_cents',
  'recovered_cents',
  'browsers_live',
  'escrow_state',
  'pledges_real',
  'pledges_simulated',
  'settlement_txs',
  'price_change_pct',
  'cost_per_recovery_cents',
  'find_run',
  'emails_read',
  'review_anchor',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
