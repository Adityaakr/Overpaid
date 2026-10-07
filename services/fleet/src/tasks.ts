import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import { canTransition, type TaskMode, type TaskState } from '@overpaid/shared';
import { runAgent } from './agent.js';
import type { FleetConfig } from './config.js';
import { EvidenceRecorder } from './evidence.js';
import { taskLogger, type Logger } from './log.js';
import type { ModelClient } from './model/index.js';
import type { FleetSession, SessionProvider } from './providers/index.js';
import { resolveRecipe, type Recipe, type ResolvedRecipe } from './recipes.js';
import { isScriptedResult, loadScripted, scriptedPath, type ScriptedApprovalRequest } from './scripted.js';
import { Screencast } from './screencast.js';
import { scanSuspicious, type ToolContext } from './tools.js';
import { Deadline, isTransient, withRetry } from './util.js';
import type { Verifier } from './verify.js';

export type RequestedMode = 'agent' | 'scripted' | 'auto';

export interface PendingApproval {
  approvalId: string;
  step: string;
  reason: string;
  screenshotUrl: string;
  requestedAt: string;
}

export interface TaskView {
  taskId: string;
  recipeId: string;
  merchant: string;
  vigil: string;
  params: Record<string, unknown>;
  requestedMode: RequestedMode;
  mode: TaskMode;
  modeReason: string;
  state: TaskState;
  step: string | null;
  stepCount: number;
  provider: string;
  sessionId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  amountCents: number | null;
  confirmationCode: string | null;
  evidenceSha256: string | null;
  evidencePath: string | null;
  failureReason: string | null;
  agentClaim: { summary: string; confirmationCode?: string; amountCents?: number } | null;
  verifiedStatus: string | null;
  /** True when the status page shows the money actually recovered (not just the request accepted). */
  recovered: boolean;
  pendingApproval: PendingApproval | null;
  flags: { text: string; source: string; at: string }[];
  cost: { inputTokens: number; outputTokens: number; browserSeconds: number; cents: number };
}

export type FleetEvent =
  | { type: 'task.updated'; data: Record<string, unknown> }
  | { type: 'approval.requested'; data: { taskId: string; approvalId: string; step: string; reason: string; screenshotUrl: string } }
  | { type: 'task.flagged'; data: { taskId: string; text: string; source: string } };

interface TaskInternal {
  view: TaskView;
  resolved: ResolvedRecipe;
  recipe: Recipe;
  log: Logger;
  cancelled: boolean;
  session: FleetSession | null;
  screencast: Screencast | null;
  approvalWaiter: { approvalId: string; resolve: (ok: boolean) => void } | null;
  approvalImages: Map<string, Buffer>;
  deadline: Deadline | null;
}

export class TaskError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class TaskManager {
  readonly events = new EventEmitter();
  private tasks = new Map<string, TaskInternal>();
  private queue: PQueue;

  constructor(
    private cfg: FleetConfig,
    private recipes: Map<string, Recipe>,
    private provider: SessionProvider,
    private model: ModelClient | null,
    private verifier: Verifier,
  ) {
    this.queue = new PQueue({ concurrency: Math.max(1, cfg.maxSessions) });
    this.events.setMaxListeners(500);
  }

  list(): TaskView[] {
    return [...this.tasks.values()].map((t) => t.view);
  }
  get(id: string): TaskView | undefined {
    return this.tasks.get(id)?.view;
  }
  queueStats() {
    return { running: this.queue.pending, waiting: this.queue.size, concurrency: this.queue.concurrency };
  }
  screencast(id: string): Screencast | null {
    return this.tasks.get(id)?.screencast ?? null;
  }
  session(id: string): FleetSession | null {
    return this.tasks.get(id)?.session ?? null;
  }
  approvalImage(id: string, approvalId: string): Buffer | undefined {
    return this.tasks.get(id)?.approvalImages.get(approvalId);
  }

  /** Idempotent on taskId: re-posting an existing task returns it unchanged (a failed task is re-queued only with retry:true). */
  submit(input: { taskId: string; recipeId: string; params?: Record<string, unknown>; mode?: RequestedMode; retry?: boolean }): { task: TaskView; created: boolean } {
    const existing = this.tasks.get(input.taskId);
    if (existing) {
      if (existing.view.recipeId !== input.recipeId) throw new TaskError(409, `task ${input.taskId} already exists with recipe ${existing.view.recipeId}`);
      if (!(input.retry && existing.view.state === 'failed')) return { task: existing.view, created: false };
    }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(input.taskId)) throw new TaskError(400, 'taskId must match [A-Za-z0-9._-]{1,100}');
    const recipe = this.recipes.get(input.recipeId);
    if (!recipe) throw new TaskError(404, `unknown recipe ${input.recipeId}`);
    const params = input.params ?? {};
    let resolved: ResolvedRecipe;
    try {
      resolved = resolveRecipe(recipe, params, this.cfg);
    } catch (e) {
      throw new TaskError(400, (e as Error).message);
    }
    const requestedMode = input.mode ?? 'auto';
    const { mode, modeReason } = this.pickMode(recipe, requestedMode);
    const view: TaskView = {
      taskId: input.taskId,
      recipeId: recipe.id,
      merchant: recipe.merchant,
      vigil: recipe.vigil,
      params,
      requestedMode,
      mode,
      modeReason,
      state: 'queued',
      step: null,
      stepCount: 0,
      provider: this.provider.kind,
      sessionId: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      amountCents: null,
      confirmationCode: null,
      evidenceSha256: null,
      evidencePath: null,
      failureReason: null,
      agentClaim: null,
      verifiedStatus: null,
      recovered: false,
      pendingApproval: null,
      flags: [],
      cost: { inputTokens: 0, outputTokens: 0, browserSeconds: 0, cents: 0 },
    };
    const t: TaskInternal = {
      view,
      resolved,
      recipe,
      log: taskLogger(input.taskId),
      cancelled: false,
      session: null,
      screencast: null,
      approvalWaiter: null,
      approvalImages: new Map(),
      deadline: null,
    };
    this.tasks.set(input.taskId, t);
    t.log.info({ recipeId: recipe.id, mode, modeReason }, 'task queued');
    this.emitUpdate(t);
    void this.queue.add(() => this.run(t));
    return { task: view, created: true };
  }

  private pickMode(recipe: Recipe, requested: RequestedMode): { mode: TaskMode; modeReason: string } {
    const hasScript = recipe.scripted !== null && scriptedPath(recipe.scripted) !== null;
    if (requested === 'scripted') {
      if (!hasScript) throw new TaskError(400, `recipe ${recipe.id} has no scripted solution available`);
      return { mode: 'scripted', modeReason: 'scripted mode requested' };
    }
    if (this.model) return { mode: 'agent', modeReason: `agent (${this.model.kind} ${this.model.model})` };
    if (!hasScript) throw new TaskError(503, `no model credentials and recipe ${recipe.id} has no scripted solution`);
    return { mode: 'scripted', modeReason: requested === 'agent' ? 'agent requested but no model credentials; running scripted' : 'no model credentials; running scripted' };
  }

  decideApproval(id: string, approved: boolean, approvalId?: string): TaskView {
    const t = this.tasks.get(id);
    if (!t) throw new TaskError(404, `unknown task ${id}`);
    const w = t.approvalWaiter;
    if (!w || t.view.state !== 'needs_approval') throw new TaskError(409, `task ${id} is not waiting for approval (state ${t.view.state})`);
    if (approvalId && approvalId !== w.approvalId) throw new TaskError(409, `approval ${approvalId} is not the pending one (${w.approvalId})`);
    t.log.info({ approvalId: w.approvalId, approved }, 'approval decided');
    w.resolve(approved);
    return t.view;
  }

  async cancel(id: string): Promise<TaskView> {
    const t = this.tasks.get(id);
    if (!t) throw new TaskError(404, `unknown task ${id}`);
    if (['done', 'failed', 'refunded'].includes(t.view.state)) return t.view;
    t.cancelled = true;
    t.approvalWaiter?.resolve(false);
    if (t.view.state === 'queued') {
      this.finishFailed(t, 'cancelled by user');
    } else {
      // Closing the session aborts any in-flight page action.
      await t.session?.stop().catch(() => {});
    }
    return t.view;
  }

  async shutdown(): Promise<void> {
    this.queue.clear();
    for (const t of this.tasks.values()) {
      t.cancelled = true;
      t.approvalWaiter?.resolve(false);
      await t.screencast?.stop().catch(() => {});
      await t.session?.stop().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------------------------------------

  private setState(t: TaskInternal, to: TaskState, patch: Partial<TaskView> = {}) {
    if (t.view.state !== to && !canTransition(t.view.state, to)) {
      t.log.warn({ from: t.view.state, to }, 'illegal state transition ignored');
      return;
    }
    Object.assign(t.view, patch, { state: to });
    this.emitUpdate(t);
  }

  private setStep(t: TaskInternal, step: string) {
    t.view.step = step;
    t.view.stepCount++;
    this.emitUpdate(t);
  }

  private emitUpdate(t: TaskInternal) {
    const v = t.view;
    const data: Record<string, unknown> = { taskId: v.taskId, state: v.state, step: v.step, mode: v.mode, recipeId: v.recipeId, costCents: v.cost.cents };
    if (v.amountCents !== null) data.amountCents = v.amountCents;
    if (v.confirmationCode) data.confirmationCode = v.confirmationCode;
    if (v.evidenceSha256) data.evidenceSha256 = v.evidenceSha256;
    if (v.evidencePath) data.manifestPath = v.evidencePath;
    if (v.verifiedStatus) {
      data.verifiedStatus = v.verifiedStatus;
      data.recovered = v.recovered;
    }
    if (v.failureReason) data.failureReason = v.failureReason;
    if (v.verifiedStatus === 'researched' && v.agentClaim?.summary) data.summary = v.agentClaim.summary;
    this.events.emit('event', { type: 'task.updated', data } satisfies FleetEvent);
  }

  private finishFailed(t: TaskInternal, reason: string) {
    t.log.warn({ reason }, 'task failed');
    this.setState(t, 'failed', { failureReason: reason, finishedAt: new Date().toISOString(), pendingApproval: null });
  }

  private meterCost(t: TaskInternal) {
    const c = t.view.cost;
    if (t.session) c.browserSeconds = Math.round((Date.now() - t.session.startedAt) / 1000);
    const cents =
      (c.inputTokens / 1e6) * this.cfg.inputCentsPerMTok + (c.outputTokens / 1e6) * this.cfg.outputCentsPerMTok + (c.browserSeconds / 60) * this.cfg.browserCentsPerMinute;
    c.cents = Math.round(cents * 100) / 100;
  }

  private flag(t: TaskInternal, text: string, source: 'agent' | 'scanner') {
    if (t.view.flags.some((f) => f.text === text)) return;
    t.view.flags.push({ text, source, at: new Date().toISOString() });
    t.log.warn({ text, source }, 'page text flagged');
    this.events.emit('event', { type: 'task.flagged', data: { taskId: t.view.taskId, text, source } } satisfies FleetEvent);
  }

  private async requestApproval(t: TaskInternal, ev: EvidenceRecorder, step: string, reason: string): Promise<boolean> {
    if (t.cancelled) return false;
    const approvalId = `${t.view.taskId}-appr-${randomUUID().slice(0, 8)}`;
    const page = t.session?.page;
    const png = page ? await page.screenshot({ type: 'png' }).catch(() => null) : null;
    if (png) {
      t.approvalImages.set(approvalId, png);
      await ev.saveImage(`${approvalId}.png`, png).catch(() => {});
    }
    await ev.record(null, `approval requested: ${step} (${reason})`);
    const screenshotUrl = `/tasks/${encodeURIComponent(t.view.taskId)}/approvals/${encodeURIComponent(approvalId)}.png`;
    const pending: PendingApproval = { approvalId, step, reason, screenshotUrl, requestedAt: new Date().toISOString() };
    t.deadline?.pause();
    const decision = new Promise<boolean>((resolve) => {
      t.approvalWaiter = { approvalId, resolve };
    });
    this.setState(t, 'needs_approval', { pendingApproval: pending, step: `waiting for approval: ${step}` });
    this.events.emit('event', { type: 'approval.requested', data: { taskId: t.view.taskId, approvalId, step, reason, screenshotUrl } } satisfies FleetEvent);
    const ok = await decision;
    t.approvalWaiter = null;
    t.deadline?.resume();
    await ev.record(null, `approval ${ok ? 'granted' : 'rejected'}: ${step}`);
    if (ok && !t.cancelled) this.setState(t, 'running', { pendingApproval: null, step: `approved: ${step}` });
    else t.view.pendingApproval = null;
    return ok && !t.cancelled;
  }

  private async run(t: TaskInternal): Promise<void> {
    if (t.cancelled || t.view.state !== 'queued') return;
    const { resolved, recipe, log } = t;
    const ev = new EvidenceRecorder(this.cfg.evidenceDir, t.view.taskId);
    let rejected: string | null = null;
    try {
      await ev.init();
      this.setState(t, 'running', { startedAt: new Date().toISOString(), step: 'starting browser' });
      t.session = await withRetry(
        () =>
          this.provider.start({
            taskId: t.view.taskId,
            allowedDomains: resolved.allowedDomains,
            blockedPaths: recipe.blockedPaths,
            cookieOrigins: [resolved.origin],
            onBlocked: (url) => {
              log.warn({ url }, 'request blocked by allowlist');
              if (!/\.(png|jpe?g|gif|svg|ico|woff2?|css)(\?|$)/i.test(url)) this.flag(t, `blocked off-allowlist request: ${url}`, 'scanner');
            },
          }),
        { attempts: 3, baseMs: 1000, retryable: isTransient, onRetry: (e, n) => log.warn({ err: String(e), attempt: n }, 'session start failed; retrying') },
      );
      t.view.sessionId = t.session.id;
      const page = t.session.page;
      t.screencast = new Screencast(page, this.cfg.screencastFps, log);
      await t.screencast.start();
      t.deadline = new Deadline(recipe.maxSeconds * 1000);
      const deadline = t.deadline;
      const timer = setInterval(() => {
        this.meterCost(t);
        if (deadline.expired() && !t.cancelled && t.view.state === 'running') {
          log.warn('time limit reached; closing session');
          t.cancelled = true;
          rejected ??= `time limit ${recipe.maxSeconds}s reached`;
          void t.session?.stop();
        }
      }, 1000);

      const approved = new Set<string>();
      const approve = async (step: string, reason: string) => {
        const ok = await this.requestApproval(t, ev, step, reason);
        if (ok) approved.add(step);
        else rejected ??= t.cancelled ? 'cancelled by user' : `user rejected step ${step}: ${reason}`;
        return ok;
      };

      let claim: { summary: string; confirmationCode?: string; amountCents?: number } | null = null;
      let failure: string | null = null;
      try {
        this.setStep(t, `open ${resolved.entryUrl}`);
        await page.goto(resolved.entryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await ev.record(page, `navigate ${resolved.entryUrl}`);

        if (t.view.mode === 'agent' && this.model) {
          const ctx: ToolContext = {
            allowedDomains: resolved.allowedDomains,
            blockedPaths: recipe.blockedPaths,
            recipe,
            approved,
            requestApproval: approve,
            record: async (action) => {
              await ev.record(page, action);
            },
            flag: (text, source) => this.flag(t, text, source),
          };
          const res = await runAgent({
            page,
            resolved,
            model: this.model,
            ctx,
            deadline,
            log,
            isCancelled: () => t.cancelled,
            onUsage: (u) => {
              t.view.cost.inputTokens += u.inputTokens;
              t.view.cost.outputTokens += u.outputTokens;
            },
            onStep: (label) => this.setStep(t, label),
          });
          if (res.kind === 'complete') claim = res.claim;
          else failure = res.reason;
        } else {
          const run = await loadScripted(recipe.scripted!);
          page.on('load', () => {
            void ev.record(page, `load ${page.url()}`);
            // Same injection scanner as agent mode, so the UI shows bait text was seen and ignored.
            void page
              .locator('body')
              .innerText({ timeout: 2000 })
              .then((text) => {
                for (const hit of scanSuspicious(text, resolved.allowedDomains)) this.flag(t, hit, 'scanner');
              })
              .catch(() => {});
          });
          this.setStep(t, `scripted ${recipe.scripted}`);
          const out = await run(page, {
            ...resolved.params,
            baseUrl: resolved.origin,
            injectSession: false,
            waitForFinal: false,
            actionTimeoutMs: 10_000,
            requestApproval: async (req: ScriptedApprovalRequest) => {
              this.setStep(t, req.action);
              return approve(req.action, req.description);
            },
          });
          if (isScriptedResult(out)) {
            for (const st of out.steps) log.debug({ step: st }, 'scripted step');
            if (out.outcome === 'approval_denied') failure = rejected ?? 'user rejected the irreversible step';
            else if (out.outcome === 'failed') failure = `scripted run failed: ${out.error ?? 'unknown'}`;
            else claim = { summary: `scripted ${recipe.scripted}: ${out.outcome} (${out.merchantStatus ?? '?'})`, ...claimFields(out) };
          } else {
            claim = { summary: `scripted ${recipe.scripted} finished`, ...claimFields(out) };
          }
        }
      } catch (e) {
        failure = rejected ?? (t.cancelled ? 'cancelled by user' : `error: ${(e as Error).message?.split('\n')[0] ?? String(e)}`);
      } finally {
        clearInterval(timer);
      }
      if (rejected) failure = rejected;
      t.view.agentClaim = claim;

      // Research runs have no status page: the agent's findings are the result, with the screenshots as evidence.
      if (!failure && recipe.research) {
        if (!claim?.summary?.trim()) failure = 'the agent finished without findings';
        else {
          t.view.verifiedStatus = 'researched';
          t.view.recovered = false;
        }
      }
      // Independent verification from the merchant's status page: never trust the agent's (or script's) claim.
      if (!failure && !recipe.research && recipe.successSignal) {
        this.setStep(t, 'verifying on status page');
        await ev.record(page, 'final page');
        const v = await this.verifier.verify(resolved, recipe.successSignal.waitSeconds);
        t.view.verifiedStatus = v.status;
        t.view.recovered = v.ok && v.final;
        if (v.excerpt) ev.excerpt(v.excerpt);
        if (v.screenshot) {
          const sha = await ev.saveImage('verification.png', v.screenshot);
          ev.steps.push({ url: resolved.statusUrl, action: `verify ${v.detail}`, timestamp: new Date().toISOString(), screenshot_sha256: sha, file: 'verification.png' });
        }
        if (v.ok) {
          t.view.amountCents = v.amountCents;
          t.view.confirmationCode = v.confirmationCode;
          if (claim?.confirmationCode && v.confirmationCode && claim.confirmationCode !== v.confirmationCode) {
            log.warn({ claimed: claim.confirmationCode, verified: v.confirmationCode }, 'agent claim differs from status page; using status page');
          }
        } else {
          failure = `verification failed: ${v.detail}`;
        }
      }
      for (const f of t.view.flags) ev.excerpt(`[flagged] ${f.text}`);

      this.meterCost(t);
      const outcome = failure ? `failed: ${failure}` : `verified: ${t.view.verifiedStatus}`;
      const fin = await ev.finalize({ merchant: recipe.merchant, vigil_type: recipe.vigil, outcome, confirmation_code: t.view.confirmationCode });
      t.view.evidenceSha256 = fin.sha256;
      t.view.evidencePath = fin.path;
      if (failure) this.finishFailed(t, failure);
      else {
        log.info({ amountCents: t.view.amountCents, confirmationCode: t.view.confirmationCode, evidence: fin.sha256 }, 'task done (verified)');
        this.setState(t, 'done', { finishedAt: new Date().toISOString(), step: 'verified', pendingApproval: null });
      }
    } catch (e) {
      log.error({ err: String(e) }, 'task crashed');
      this.finishFailed(t, rejected ?? `error: ${(e as Error).message?.split('\n')[0] ?? String(e)}`);
    } finally {
      this.meterCost(t);
      await t.screencast?.stop().catch(() => {});
      await t.session?.stop().catch(() => {});
      this.emitUpdate(t);
    }
  }
}

function claimFields(x: unknown): { confirmationCode?: string; amountCents?: number } {
  const out: { confirmationCode?: string; amountCents?: number } = {};
  if (typeof x !== 'object' || x === null) return out;
  const o = x as Record<string, unknown>;
  if (typeof o.confirmationCode === 'string') out.confirmationCode = o.confirmationCode;
  if (typeof o.amountCents === 'number') out.amountCents = o.amountCents;
  return out;
}
