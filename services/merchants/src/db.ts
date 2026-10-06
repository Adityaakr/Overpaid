import { createHash } from 'node:crypto';
import postgres from 'postgres';
import {
  CARTWELL_ORDERS,
  PARCELO_ORDERS,
  SKYLANE_FLIGHT,
  VISTAFLIX_PLANS,
  type MerchantKey,
} from '@overpaid/shared';
import { config } from './config.js';

export const sql = postgres(config.databaseUrl, {
  connection: { search_path: config.schema },
  onnotice: () => {},
  max: 10,
});

export type Sql = typeof sql;

/** Idempotent DDL. Every table lives in the dedicated schema (default `merchants`). */
export async function ensureSchema(): Promise<void> {
  await sql.unsafe(`create schema if not exists ${config.schema}`);
  await sql.unsafe(`
    create table if not exists seeded (site text primary key, at timestamptz not null default now());

    create table if not exists request_log (
      id bigserial primary key, site text not null, method text not null, path text not null,
      status int, agent boolean not null default false, agent_method text, at timestamptz not null default now());
    create index if not exists request_log_site_idx on request_log (site, id desc);

    create table if not exists events (
      id bigserial primary key, site text not null, kind text not null, detail jsonb not null default '{}'::jsonb,
      agent boolean not null default false, at timestamptz not null default now());

    create table if not exists vistaflix_plans (
      id text primary key, plan text not null, amount_cents int not null, cadence text not null,
      started_on text not null, last_watched text, next_renewal text not null, from_free_trial boolean not null default false,
      status text not null default 'active', cancel_stage text not null default 'none', survey_reason text,
      discount_pct int not null default 0, confirmation_code text, cancelled_at timestamptz, sort int not null default 0);

    create table if not exists cartwell_orders (
      order_id text primary key, item text not null, paid_cents int not null, price_now_cents int,
      ordered_on text not null, sort int not null default 0);
    create table if not exists cartwell_charges (
      id bigserial primary key, order_id text not null, amount_cents int not null, label text not null, on_date text not null);
    create table if not exists cartwell_tickets (
      id text primary key, order_id text not null, reason text not null, kind text not null, amount_cents int not null,
      store_credit boolean not null, details text not null, email text not null, created_at timestamptz not null default now());

    create table if not exists skylane_bookings (
      ref text primary key, flight text not null, route text not null, flight_date text not null,
      scheduled_departure text not null, actual_departure text not null, delay_minutes int not null,
      delay_category text not null, fare_cents int not null, compensation_cents int not null, passenger text not null);
    create table if not exists skylane_claims (
      id text primary key, booking_ref text not null, passenger text not null, category text not null, payout text not null,
      amount_cents int not null, created_at timestamptz not null default now());

    create table if not exists parcelo_orders (
      order_id text primary key, item text not null, paid_cents int not null, shipped_on text not null,
      promised_by text not null, delivered boolean not null, seller_ack boolean not null default false, sort int not null default 0);
    create table if not exists parcelo_claims (
      id text primary key, order_id text not null, reason text not null, details text not null,
      amount_cents int not null, created_at timestamptz not null default now());
  `);
}

const SITE_TABLES: Record<MerchantKey, string[]> = {
  vistaflix: ['vistaflix_plans'],
  cartwell: ['cartwell_orders', 'cartwell_charges', 'cartwell_tickets'],
  skylane: ['skylane_bookings', 'skylane_claims'],
  parcelo: ['parcelo_orders', 'parcelo_claims'],
};

/** Restore one site's seed state from demo-world.ts. Also clears that site's request log and events. */
export async function resetSite(site: MerchantKey): Promise<void> {
  await sql.begin(async (tx) => {
    for (const t of SITE_TABLES[site]) await tx.unsafe(`delete from ${t}`);
    await tx`delete from request_log where site = ${site}`;
    await tx`delete from events where site = ${site}`;
    await seedSite(tx, site);
    await tx`insert into seeded (site) values (${site}) on conflict (site) do update set at = now()`;
  });
}

type Tx = postgres.TransactionSql;

async function seedSite(tx: Tx, site: MerchantKey): Promise<void> {
  switch (site) {
    case 'vistaflix': {
      let sort = 0;
      for (const p of VISTAFLIX_PLANS) {
        const fromTrial = 'fromFreeTrial' in p ? Boolean(p.fromFreeTrial) : false;
        await tx`insert into vistaflix_plans (id, plan, amount_cents, cadence, started_on, last_watched, next_renewal, from_free_trial, sort)
          values (${p.id}, ${p.plan}, ${p.amount}, ${p.cadence}, ${p.startedOn}, ${p.lastWatched}, ${p.nextRenewal}, ${fromTrial}, ${sort++})`;
      }
      return;
    }
    case 'cartwell': {
      let sort = 0;
      for (const o of CARTWELL_ORDERS) {
        const priceNow = ('priceNow' in o ? o.priceNow : undefined) ?? null;
        await tx`insert into cartwell_orders (order_id, item, paid_cents, price_now_cents, ordered_on, sort)
          values (${o.orderId}, ${o.item}, ${o.paid}, ${priceNow}, ${o.date}, ${sort++})`;
        const times = ('chargedTimes' in o ? o.chargedTimes : undefined) ?? 1;
        for (let i = 0; i < times; i++) {
          await tx`insert into cartwell_charges (order_id, amount_cents, label, on_date)
            values (${o.orderId}, ${o.paid}, ${`Charge to Visa ending 4417${i > 0 ? ' (processed again)' : ''}`}, ${o.date})`;
        }
      }
      return;
    }
    case 'skylane': {
      const f = SKYLANE_FLIGHT;
      await tx`insert into skylane_bookings (ref, flight, route, flight_date, scheduled_departure, actual_departure, delay_minutes,
          delay_category, fare_cents, compensation_cents, passenger)
        values (${f.bookingRef}, ${f.flight}, ${f.route}, ${f.date}, ${f.scheduledDeparture}, ${f.actualDeparture}, ${f.delayMinutes},
          ${f.delayCategory}, ${f.fare}, ${f.compensation}, ${f.passenger})`;
      return;
    }
    case 'parcelo': {
      let sort = 0;
      for (const o of PARCELO_ORDERS) {
        await tx`insert into parcelo_orders (order_id, item, paid_cents, shipped_on, promised_by, delivered, sort)
          values (${o.orderId}, ${o.item}, ${o.paid}, ${o.shippedOn}, ${o.promisedBy}, ${o.delivered}, ${sort++})`;
      }
      return;
    }
  }
}

/** Seed every site that has never been seeded (first boot). Existing state is kept across restarts. */
export async function seedIfNeeded(sites: MerchantKey[]): Promise<void> {
  const rows = await sql<{ site: string }[]>`select site from seeded`;
  const done = new Set(rows.map((r) => r.site));
  for (const s of sites) if (!done.has(s)) await resetSite(s);
}

/** Deterministic short code: same seed always yields the same code. */
export function codeFrom(seed: string, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', len = 4): string {
  const h = createHash('sha256').update(seed).digest();
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[h[i]! % alphabet.length];
  return out;
}

export const digitsFrom = (seed: string, len = 4): string => codeFrom(seed, '0123456789', len);

export async function logEvent(site: MerchantKey, kind: string, detail: Record<string, unknown>, agent: boolean): Promise<void> {
  await sql`insert into events (site, kind, detail, agent) values (${site}, ${kind}, ${sql.json(detail as postgres.JSONValue)}, ${agent})`;
}
