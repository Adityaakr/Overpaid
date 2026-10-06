/**
 * Durable job + quote storage (Postgres schema `specialist`, created on boot) so a restart never loses an
 * escrowed job or a quote a buyer is about to pay. A memory store backs the tests.
 */
import postgres from 'postgres';
import type { MasumiTerms, MasumiTermsStorage, MasumiTermsUpdateResult } from '@x402/cardano';
import { ACTIVE, type Job } from './jobs.js';

export interface JobStore {
  init(): Promise<void>;
  /** Insert unless a job with the same lockTx exists; returns the stored job (idempotent paid retries). */
  insertIfAbsent(job: Job): Promise<Job>;
  get(id: string): Promise<Job | null>;
  byLockTx(txHash: string): Promise<Job | null>;
  update(id: string, patch: Partial<Job>, event?: string): Promise<Job>;
  active(): Promise<Job[]>;
  list(limit?: number): Promise<Job[]>;
  close(): Promise<void>;
}

const now = () => new Date().toISOString();
function applyPatch(job: Job, patch: Partial<Job>, event?: string): Job {
  const next: Job = { ...job, ...patch, updatedAt: now() };
  if (event) next.events = [...job.events, { at: next.updatedAt, msg: event }].slice(-200);
  return next;
}

export class MemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();
  async init() {}
  async insertIfAbsent(job: Job) {
    const existing = [...this.jobs.values()].find((j) => j.lockTx === job.lockTx);
    if (existing) return existing;
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }
  async get(id: string) {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
  async byLockTx(tx: string) {
    const j = [...this.jobs.values()].find((x) => x.lockTx === tx);
    return j ? structuredClone(j) : null;
  }
  async update(id: string, patch: Partial<Job>, event?: string) {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`job ${id} not found`);
    const next = applyPatch(j, patch, event);
    this.jobs.set(id, next);
    return structuredClone(next);
  }
  async active() {
    return [...this.jobs.values()].filter((j) => ACTIVE.includes(j.status)).map((j) => structuredClone(j));
  }
  async list(limit = 100) {
    return [...this.jobs.values()].slice(-limit).reverse().map((j) => structuredClone(j));
  }
  async close() {}
}

export class PgJobStore implements JobStore {
  readonly sql: postgres.Sql;
  constructor(url: string) {
    this.sql = postgres(url, { max: 4, onnotice: () => {} });
  }
  async init() {
    await this.sql`create schema if not exists specialist`;
    await this.sql`create table if not exists specialist.jobs (
      id text primary key,
      lock_tx text not null unique,
      status text not null,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now())`;
    await this.sql`create index if not exists jobs_status_idx on specialist.jobs (status)`;
    await this.sql`create table if not exists specialist.quotes (
      terms_digest text primary key,
      record jsonb not null,
      created_at timestamptz not null default now())`;
  }
  private row = (r: { data: Job }) => r.data;
  async insertIfAbsent(job: Job) {
    await this.sql`insert into specialist.jobs (id, lock_tx, status, data)
      values (${job.id}, ${job.lockTx}, ${job.status}, ${this.sql.json(job as never)}) on conflict (lock_tx) do nothing`;
    return (await this.byLockTx(job.lockTx))!;
  }
  async get(id: string) {
    const [r] = await this.sql<{ data: Job }[]>`select data from specialist.jobs where id = ${id}`;
    return r ? this.row(r) : null;
  }
  async byLockTx(tx: string) {
    const [r] = await this.sql<{ data: Job }[]>`select data from specialist.jobs where lock_tx = ${tx}`;
    return r ? this.row(r) : null;
  }
  async update(id: string, patch: Partial<Job>, event?: string) {
    return this.sql.begin(async (tx) => {
      const [r] = await tx<{ data: Job }[]>`select data from specialist.jobs where id = ${id} for update`;
      if (!r) throw new Error(`job ${id} not found`);
      const next = applyPatch(r.data, patch, event);
      await tx`update specialist.jobs set status = ${next.status}, data = ${tx.json(next as never)}, updated_at = now() where id = ${id}`;
      return next;
    }) as Promise<Job>;
  }
  async active() {
    const rows = await this.sql<{ data: Job }[]>`select data from specialist.jobs where status in ${this.sql(ACTIVE)} order by created_at`;
    return rows.map(this.row);
  }
  async list(limit = 100) {
    const rows = await this.sql<{ data: Job }[]>`select data from specialist.jobs order by created_at desc limit ${limit}`;
    return rows.map(this.row);
  }
  async close() {
    await this.sql.end({ timeout: 5 });
  }
}

/** Durable Masumi quote store: a paid retry must find the exact quote it was issued, even after a restart. */
export class PgTermsStorage implements MasumiTermsStorage {
  constructor(private sql: postgres.Sql) {}
  async get(digest: string): Promise<MasumiTerms | undefined> {
    const [r] = await this.sql<{ record: MasumiTerms }[]>`select record from specialist.quotes where terms_digest = ${digest}`;
    return r?.record;
  }
  async updateTerms(digest: string, update: (c: MasumiTerms | undefined) => MasumiTerms | undefined): Promise<MasumiTermsUpdateResult> {
    return this.sql.begin(async (tx) => {
      // Serialise all mutations of one digest (advisory lock covers the not-yet-existing row case).
      await tx`select pg_advisory_xact_lock(hashtext(${digest}))`;
      const [r] = await tx<{ record: MasumiTerms }[]>`select record from specialist.quotes where terms_digest = ${digest}`;
      const current = r?.record;
      const next = update(current);
      if (next === undefined) {
        if (current) await tx`delete from specialist.quotes where terms_digest = ${digest}`;
        return { terms: undefined, status: current ? 'deleted' : 'unchanged' } as MasumiTermsUpdateResult;
      }
      if (next === current) return { terms: current, status: 'unchanged' } as MasumiTermsUpdateResult;
      await tx`insert into specialist.quotes (terms_digest, record) values (${digest}, ${tx.json(next as never)})
        on conflict (terms_digest) do update set record = excluded.record`;
      return { terms: next, status: 'updated' } as MasumiTermsUpdateResult;
    }) as Promise<MasumiTermsUpdateResult>;
  }
  /** Drop quotes older than `ms` that were never claimed by a payment. */
  async prune(ms = 24 * 3600_000) {
    await this.sql`delete from specialist.quotes where created_at < now() - ${`${Math.floor(ms / 1000)} seconds`}::interval and not (record ? 'claimedTxHash')`;
  }
}
