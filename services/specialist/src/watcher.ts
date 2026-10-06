/**
 * The 10 s loop that drives every escrowed job:
 *   awaiting_payment -> locked      the lock tx's escrow output matches every signed datum field
 *   locked -> running -> evidence_ready   own browser session files the claim, "Compensation paid" observed, bundle hashed
 *   evidence_ready -> result_submitted    SubmitResult (only after re-reading "Compensation paid")
 *   result_submitted -> collected  Withdraw once chain time passes unlockTime (auto, or POST /admin/collect)
 *   any open state -> disputed / refund_authorized / refunded as the chain says
 * Chain errors never skip other jobs; work errors never produce a result.
 */
import path from 'node:path';
import {
  escrowCandidates, EscrowRuleError, followEscrow, submitResult, collect, authorizeRefund, txOutputs,
  type Blockfrost, type NamedAccount, type EscrowStatus, type EscrowCandidate, type ActionResult, type EscrowRef,
} from '@overpaid/cardano';
import type { SpecialistConfig } from './config.js';
import type { Job, JobWork } from './jobs.js';
import { findLock, lockMismatch } from './lockMatch.js';
import type { JobStore } from './store.js';
import { startSession, type SpecialistSession } from './browser.js';
import { buildManifest, EvidenceRecorder, fetchClaimStatus, fileClaim, isPaid, waitForPaid, writeEvidence } from './work.js';

export interface ChainOps {
  lockCandidates(txHash: string): Promise<EscrowCandidate[]>;
  escrowStatus(ref: EscrowRef): Promise<EscrowStatus>;
  tipMs(): Promise<bigint>;
  submitResult(ref: EscrowRef, resultHash: string, onSubmitted: (tx: string) => void): Promise<ActionResult>;
  withdraw(ref: EscrowRef, onSubmitted: (tx: string) => void): Promise<ActionResult>;
  authorizeRefund(ref: EscrowRef, onSubmitted: (tx: string) => void): Promise<ActionResult>;
}

export function chainOps(bf: Blockfrost, seller: NamedAccount): ChainOps {
  return {
    async lockCandidates(txHash) {
      const rows = await txOutputs(bf, txHash);
      return rows ? escrowCandidates(txHash, rows) : [];
    },
    escrowStatus: (ref) => followEscrow(bf, ref.txHash, ref.referenceSignature),
    tipMs: () => bf.tipMs(),
    submitResult: (ref, h, onSubmitted) => submitResult(seller, ref, h, { bf, onSubmitted }),
    withdraw: (ref, onSubmitted) => collect(seller, ref, { bf, onSubmitted }),
    authorizeRefund: (ref, onSubmitted) => authorizeRefund(seller, ref, { bf, onSubmitted }),
  };
}

export interface WorkRunner {
  (job: Job, ctx: { cfg: SpecialistConfig; store: JobStore }): Promise<void>;
}

const ref = (j: Job): EscrowRef => ({ txHash: j.lockTx, referenceSignature: j.expected.referenceSignature });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MAX_WORK_ATTEMPTS = 3;

/** Default work runner: real browser session against the Skylane demo. */
export const runSkylaneJob: WorkRunner = async (job, { cfg, store }) => {
  const dir = path.join(cfg.evidenceDir, job.id);
  const recorder = new EvidenceRecorder(dir);
  await recorder.init();
  const attempts = ((job.work as (JobWork & { attempts?: number }) | null)?.attempts ?? 0) + 1;
  const work: JobWork & { attempts: number } = {
    mode: 'specialist-builtin', browser: cfg.browserProvider, claimId: null, statusUrl: null, observedStatus: null, observedLabel: null,
    observedAt: null, amountCents: null, evidenceDir: dir, manifestPath: null, attempts,
  };
  await store.update(job.id, { status: 'running', work, error: null }, `work attempt ${attempts}: starting ${cfg.browserProvider} browser session`);
  let session: SpecialistSession | null = null;
  try {
    session = await startSession({ provider: cfg.browserProvider, headless: cfg.headless, merchantBaseUrl: cfg.skylaneBaseUrl, taskId: job.id });
    const filed = await fileClaim(session.page, { baseUrl: cfg.skylaneBaseUrl, task: job.input.input_data, recorder });
    work.mode = filed.mode;
    work.claimId = filed.claimId;
    work.statusUrl = `${cfg.skylaneBaseUrl}/claims/${filed.claimId}`;
    await store.update(job.id, { work }, `claim ${filed.claimId} filed (${filed.mode}); waiting for "Compensation paid"`);
    const deadline = Math.min(Date.now() + cfg.paidTimeoutMs, job.terms.submitResultTime - cfg.submitMarginMs - 60_000);
    const observed = await waitForPaid(cfg.skylaneBaseUrl, filed.claimId, deadline);
    await session.page.goto(work.statusUrl);
    await session.page.getByTestId('claim-status').waitFor();
    const label = (await session.page.getByTestId('claim-status-label').innerText()).trim();
    if (label !== 'Compensation paid') throw new Error(`status page shows "${label}", not "Compensation paid"`);
    await recorder.excerpt(session.page, '[data-testid="claim-status"]');
    await recorder.step(session.page, `observed "${label}" on the claim status page`, { screenshot: true });
    const manifest = buildManifest({ jobId: job.id, claimId: filed.claimId, recorder, observed });
    const { resultHash, manifestPath } = await writeEvidence(dir, manifest, observed);
    Object.assign(work, { observedStatus: observed.status, observedLabel: observed.statusLabel, observedAt: new Date().toISOString(), amountCents: observed.amountCents, manifestPath });
    await store.update(job.id, { status: 'evidence_ready', work, resultHash }, `"Compensation paid" confirmed; evidence hash ${resultHash}`);
  } catch (e) {
    const tooLate = Date.now() > job.terms.submitResultTime - cfg.submitMarginMs;
    const give = tooLate || attempts >= MAX_WORK_ATTEMPTS;
    await store.update(job.id, { status: give ? 'failed' : 'locked', work, error: msg(e) }, `work failed${give ? ' (giving up; no result will be submitted)' : ', will retry'}: ${msg(e)}`);
  } finally {
    await session?.stop().catch(() => {});
  }
};

export class Watcher {
  private busy = false;
  private working = new Set<string>();
  private logged = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: SpecialistConfig,
    private store: JobStore,
    private chain: ChainOps,
    private runWork: WorkRunner = runSkylaneJob,
    private log: (m: string) => void = (m) => console.log(m),
    private fetchStatus = fetchClaimStatus,
  ) {}

  async recover() {
    // A crash mid-run leaves 'running': re-run (the built-in script reuses an existing claim instead of refiling).
    for (const j of await this.store.active()) {
      if (j.status === 'running') await this.store.update(j.id, { status: 'locked' }, 'recovered after restart: re-running work');
    }
  }

  start() {
    this.timer = setInterval(() => void this.tick(), this.cfg.watchIntervalMs);
    void this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const job of await this.store.active()) {
        try {
          await this.advance(job);
        } catch (e) {
          await this.store.update(job.id, { error: msg(e) }, `tick error (will retry): ${msg(e)}`).catch(() => {});
        }
      }
    } catch (e) {
      this.log(`[watcher] ${msg(e)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Run work without blocking the loop; one runner per job. */
  private spawn(key: string, fn: () => Promise<void>) {
    if (this.working.has(key)) return;
    this.working.add(key);
    void fn().catch((e) => this.log(`[${key}] ${msg(e)}`)).finally(() => this.working.delete(key));
  }

  async advance(job: Job): Promise<void> {
    const now = Date.now();
    switch (job.status) {
      case 'awaiting_payment': {
        if (now > job.terms.submitResultTime - this.cfg.submitMarginMs) {
          await this.store.update(job.id, { status: 'failed', error: 'no matching escrow lock arrived in time' }, 'gave up waiting for the lock');
          return;
        }
        const cands = await this.chain.lockCandidates(job.lockTx);
        for (const c of cands) {
          const why = lockMismatch(c, job.expected);
          const key = `${job.id}:${c.txHash}#${c.outputIndex}`;
          if (why && !this.logged.has(key)) {
            this.logged.add(key);
            await this.store.update(job.id, {}, `ignoring escrow UTxO ${c.txHash}#${c.outputIndex}: ${why}`);
          }
        }
        const lock = findLock(cands, job.expected);
        if (lock) {
          await this.store.update(job.id, { status: 'locked', lock: { txHash: lock.txHash, outputIndex: lock.outputIndex, lovelace: lock.lovelace.toString() }, escrowState: 'FundsLocked' }, `lock ${lock.txHash}#${lock.outputIndex} matches the signed terms`);
        } else if (now > job.terms.payByTime + this.cfg.payByMarginMs) {
          await this.store.update(job.id, { status: 'failed', error: 'the payment tx never landed before payByTime' }, 'lock never landed');
        }
        return;
      }
      case 'locked':
        this.spawn(`work:${job.id}`, () => this.runWork(job, { cfg: this.cfg, store: this.store }));
        return;
      case 'running':
        if (!this.working.has(`work:${job.id}`)) await this.store.update(job.id, { status: 'locked' }, 'work runner missing; re-queued');
        return;
      case 'evidence_ready': {
        if (job.resultTx) {
          await this.syncEscrow(job);
          return;
        }
        if (!job.resultHash || !job.work?.claimId) throw new Error('evidence_ready without hash or claim');
        // Re-read the merchant's status right before committing the hash on chain.
        const fresh = await this.fetchStatus(this.cfg.skylaneBaseUrl, job.work.claimId).catch(() => null);
        if (!isPaid(fresh)) {
          await this.store.update(job.id, {}, `status re-check did not show "Compensation paid" (${fresh?.status ?? 'unreachable'}); not submitting`);
          return;
        }
        this.spawn(`submit:${job.id}`, async () => {
          try {
            const r = await this.chain.submitResult(ref(job), job.resultHash!, (tx) => void this.store.update(job.id, { resultTx: tx }, `SubmitResult submitted: ${tx}`));
            await this.store.update(job.id, { status: 'result_submitted', resultTx: r.txHash, escrowState: r.toState }, `SubmitResult ${r.confirmed ? 'confirmed' : 'submitted'}: ${r.txHash}`);
          } catch (e) {
            const late = Date.now() > job.terms.submitResultTime - 150_000;
            if (e instanceof EscrowRuleError && e.notBefore === undefined && late) {
              await this.store.update(job.id, { status: 'failed', error: msg(e) }, `SubmitResult window closed: ${msg(e)}`);
            } else {
              await this.store.update(job.id, { error: msg(e) }, `SubmitResult failed (will retry): ${msg(e)}`);
            }
          }
        });
        return;
      }
      case 'result_submitted':
      case 'disputed':
      case 'refund_authorized':
        await this.syncEscrow(job);
        return;
      default:
        return;
    }
  }

  /** Mirror the on-chain escrow state; collect when due. */
  private async syncEscrow(job: Job): Promise<void> {
    const s = await this.chain.escrowStatus(ref(job));
    if (s.status === 'not_found') return;
    if (s.status === 'closed') {
      const collected = job.collectTx && s.closedBy === job.collectTx;
      await this.store.update(job.id, { status: collected ? 'collected' : 'refunded', closedBy: s.closedBy, escrowState: 'closed' }, `escrow closed by ${s.closedBy}`);
      return;
    }
    const patch: Partial<Job> = { escrowState: s.state };
    if (job.status === 'evidence_ready' && job.resultTx && s.state === 'FundsLocked' && Date.now() - Date.parse(job.updatedAt) > 5 * 60_000) {
      // Our SubmitResult never landed (rejected or dropped): clear it so the next tick re-submits.
      await this.store.update(job.id, { resultTx: null }, `SubmitResult ${job.resultTx} did not land; retrying`);
      return;
    }
    if (job.status === 'evidence_ready' && s.datum.resultHash === job.resultHash) patch.status = 'result_submitted';
    if (s.state === 'Disputed' && job.status !== 'disputed') {
      await this.store.update(job.id, { ...patch, status: 'disputed' }, 'buyer disputed after our result (SetRefundRequested); awaiting operator decision (POST /admin/authorize-refund)');
      return;
    }
    if (s.state === 'RefundAuthorized' && job.status !== 'refund_authorized') patch.status = 'refund_authorized';
    if (patch.status || patch.escrowState !== job.escrowState) await this.store.update(job.id, patch, patch.status ? `escrow state ${s.state}` : undefined);
    const canCollect = s.state === 'ResultSubmitted' || s.state === 'WithdrawAuthorized';
    if (this.cfg.autoCollect && canCollect && !job.collectTx) {
      const tip = await this.chain.tipMs();
      if (s.state === 'WithdrawAuthorized' || tip >= BigInt(job.terms.unlockTime + this.cfg.collectDelayMs)) void this.collect(job).catch(() => {});
    }
  }

  /** Withdraw now (used by the loop and POST /admin/collect). Returns null if a collect is already running. */
  async collect(job: Job): Promise<ActionResult | null> {
    const key = `collect:${job.id}`;
    if (this.working.has(key)) return null;
    this.working.add(key);
    try {
      const r = await this.chain.withdraw(ref(job), (tx) => void this.store.update(job.id, { collectTx: tx }, `Withdraw submitted: ${tx}`));
      await this.store.update(job.id, { status: 'collected', collectTx: r.txHash, escrowState: 'closed', closedBy: r.txHash }, `collected: ${r.txHash}`);
      return r;
    } catch (e) {
      await this.store.update(job.id, { error: msg(e) }, `collect not possible yet: ${msg(e)}`);
      throw e;
    } finally {
      this.working.delete(key);
    }
  }

  async authorizeRefund(job: Job): Promise<ActionResult> {
    const r = await this.chain.authorizeRefund(ref(job), (tx) => void this.store.update(job.id, { refundAuthTx: tx }, `AuthorizeRefund submitted: ${tx}`));
    await this.store.update(job.id, { status: 'refund_authorized', refundAuthTx: r.txHash, escrowState: 'RefundAuthorized' }, `refund authorized: ${r.txHash}`);
    return r;
  }
}
