/**
 * The specialist's job: file the Skylane Air delay-compensation claim in its own browser session, wait until the
 * claim status page says "Compensation paid", and build the evidence bundle whose hash becomes the on-chain result.
 *
 * Claim filing prefers the merchant's scripted solution (services/merchants/scripted, `skylane` recipe, run(page,
 * opts) -> RecipeResult) and falls back to the specialist's own built-in script against the same test ids.
 * The outcome is confirmed from the merchant's machine-readable status `/claims/:id.json` (status === "paid"),
 * re-read immediately before SubmitResult. We never produce a result for an outcome we have not observed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { hashEvidence, sha256Hex, type EvidenceManifest } from '@overpaid/shared';
import type { TaskSpec } from './jobs.js';

export interface ClaimStatusJson {
  merchant: string;
  claimId: string;
  bookingRef: string;
  status: string;
  statusLabel: string;
  amountCents: number;
  payout: string;
}

export const PAID_STATUS = 'paid';
export const PAID_LABEL = 'Compensation paid';
export const isPaid = (s: ClaimStatusJson | null) => !!s && s.status === PAID_STATUS && s.statusLabel === PAID_LABEL;

export interface Step {
  url: string;
  action: string;
  timestamp: string;
  screenshot_sha256: string | null;
}

export class EvidenceRecorder {
  readonly steps: Step[] = [];
  readonly excerpts: string[] = [];
  private shots = 0;
  constructor(readonly dir: string) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }
  async step(page: Page | null, action: string, opts: { screenshot?: boolean; url?: string } = {}) {
    let sha: string | null = null;
    if (page && opts.screenshot) {
      const png = await page.screenshot({ fullPage: true });
      sha = sha256Hex(png);
      await writeFile(path.join(this.dir, `step-${String(++this.shots).padStart(2, '0')}.png`), png);
    }
    this.steps.push({ url: opts.url ?? page?.url() ?? '', action, timestamp: new Date().toISOString(), screenshot_sha256: sha });
  }
  async excerpt(page: Page, selector: string) {
    const t = (await page.locator(selector).first().innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
    if (t) this.excerpts.push(t.slice(0, 500));
  }
}

export interface ClaimRunOptions {
  baseUrl: string;
  task: TaskSpec;
  recorder: EvidenceRecorder;
}

export interface FiledClaim {
  claimId: string;
  mode: 'merchant-scripted' | 'specialist-builtin';
}

type MerchantRecipe = (page: Page, opts: Record<string, unknown>) => Promise<{ outcome: string; confirmationCode: string | null; statusUrl: string | null; error?: string; steps?: Array<{ url: string; action: string }> }>;

/** Locate the merchant's scripted Skylane recipe if the merchants package provides one. */
async function merchantRecipe(): Promise<MerchantRecipe | null> {
  try {
    const spec = '@overpaid/merchants/scripted';
    const mod = (await import(spec)) as Record<string, unknown>;
    const candidates = [mod.skylaneClaim, mod.claimSkylane, mod.skylane, (mod.recipes as Record<string, unknown> | undefined)?.['skylane-claim'], (mod.RECIPES as Record<string, unknown> | undefined)?.['skylane-claim']];
    for (const c of candidates) {
      if (typeof c === 'function') return c as MerchantRecipe;
      if (c && typeof (c as { run?: unknown }).run === 'function') return (c as { run: MerchantRecipe }).run;
    }
  } catch {
    /* not built yet */
  }
  return null;
}

/** The specialist's own Playwright script for the Skylane claim (domain knowledge: pick the recorded delay reason). */
export async function builtinSkylaneClaim(page: Page, o: ClaimRunOptions): Promise<string> {
  const { baseUrl, task, recorder: r } = o;
  page.setDefaultTimeout(15_000);
  await page.goto(`${baseUrl}/manage/${task.booking_ref}`);
  if ((await page.getByTestId('demo-login').count()) > 0) {
    await page.getByTestId('demo-login').click();
    await page.waitForLoadState('load');
  }
  await page.getByTestId('booking').waitFor();
  await r.step(page, `open booking ${task.booking_ref}`, { screenshot: true });
  await r.excerpt(page, '[data-testid="booking"]');
  const existing = page.getByTestId('existing-claim');
  if ((await existing.count()) > 0) {
    const id = (await existing.innerText()).trim();
    await r.step(page, `existing claim found: ${id} (not resubmitting)`);
    return id;
  }
  await page.locator('details summary').first().click().catch(() => {});
  const reason = (await page.getByTestId('delay-reason').innerText()).trim();
  await r.step(page, `read disruption details: delay reason "${reason}"`);
  await page.goto(`${baseUrl}/claims/new`);
  await page.getByTestId('claim-form').waitFor();
  await page.getByTestId('claim-booking-ref').fill(task.booking_ref);
  await page.getByTestId('claim-passenger-name').fill(task.passenger_name);
  await page.getByTestId('claim-delay-category').selectOption(reason);
  await page.getByTestId(`claim-payout-${task.payout}`).check();
  if (task.payout === 'bank_transfer') {
    await page.getByTestId('claim-account-holder').fill(task.account_holder ?? '');
    await page.getByTestId('claim-account-number').fill(task.account_number ?? '');
  }
  await page.getByTestId('claim-declaration').check();
  await r.step(page, `fill claim form (category "${reason}", payout ${task.payout})`, { screenshot: true });
  await page.getByTestId('claim-submit').click();
  await page.waitForLoadState('load');
  if ((await page.getByTestId('claim-rejected').count()) > 0) {
    const codes = await page.getByTestId('claim-rejected').getAttribute('data-rejection-codes');
    await r.step(page, `claim rejected: ${codes}`, { screenshot: true });
    throw new Error(`Skylane rejected the claim (${codes})`);
  }
  const status = page.getByTestId('claim-status');
  await status.waitFor();
  const id = (await status.getAttribute('data-claim-id')) ?? '';
  await r.step(page, `claim submitted: ${id}`, { screenshot: true });
  if (!/^SKC-/.test(id)) throw new Error('claim id not found on the status page');
  return id;
}

export async function fileClaim(page: Page, o: ClaimRunOptions): Promise<FiledClaim> {
  const recipe = await merchantRecipe();
  if (recipe) {
    const res = await recipe(page, { requestApproval: async () => true, baseUrl: o.baseUrl, injectSession: false, waitForFinal: false, task: o.task, bookingRef: o.task.booking_ref, passengerName: o.task.passenger_name, payout: o.task.payout });
    for (const s of res.steps ?? []) await o.recorder.step(null, s.action, { url: s.url });
    if ((res.outcome === 'success' || res.outcome === 'pending') && res.confirmationCode) {
      await o.recorder.step(page, `merchant script filed claim ${res.confirmationCode}`, { screenshot: true });
      return { claimId: res.confirmationCode, mode: 'merchant-scripted' };
    }
    await o.recorder.step(page, `merchant script did not file the claim (${res.outcome}: ${res.error ?? ''}); using built-in script`);
  }
  return { claimId: await builtinSkylaneClaim(page, o), mode: 'specialist-builtin' };
}

export async function fetchClaimStatus(baseUrl: string, claimId: string, fetchImpl: typeof fetch = fetch): Promise<ClaimStatusJson | null> {
  // The status page belongs to the user's own (demo) account, so the check carries the same session cookie.
  const cookie = `demo_session=${process.env.DEMO_SESSION_COOKIE || 'alex-demo'}`;
  const res = await fetchImpl(`${baseUrl}/claims/${encodeURIComponent(claimId)}.json`, {
    headers: { 'x-overpaid-agent': 'specialist status check', cookie },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as ClaimStatusJson;
}

/** Poll the merchant status JSON until "Compensation paid" or the deadline. */
export async function waitForPaid(baseUrl: string, claimId: string, deadlineMs: number, pollMs = 5_000, fetchImpl: typeof fetch = fetch): Promise<ClaimStatusJson> {
  let last: ClaimStatusJson | null = null;
  while (Date.now() < deadlineMs) {
    last = await fetchClaimStatus(baseUrl, claimId, fetchImpl).catch(() => null);
    if (isPaid(last)) return last!;
    if (last && last.status === 'voucher_issued') throw new Error('claim resolved as a travel voucher, not "Compensation paid"');
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`"Compensation paid" not observed for ${claimId} before the deadline (last status: ${last?.status ?? 'unknown'})`);
}

export function buildManifest(args: { jobId: string; claimId: string; recorder: EvidenceRecorder; observed: ClaimStatusJson }): EvidenceManifest {
  return {
    task_id: args.jobId,
    merchant: 'skylane',
    vigil_type: 'flight_compensation',
    steps: args.recorder.steps,
    page_text_excerpts: [...args.recorder.excerpts, `status ${args.observed.claimId}: ${args.observed.statusLabel} (${args.observed.amountCents} cents, ${args.observed.payout})`],
    outcome: args.observed.statusLabel,
    confirmation_code: args.claimId,
  };
}

/** Write manifest.json + status.json and return the result hash (hashEvidence over the manifest). */
export async function writeEvidence(dir: string, manifest: EvidenceManifest, observed: ClaimStatusJson): Promise<{ resultHash: string; manifestPath: string }> {
  if (manifest.outcome !== PAID_LABEL) throw new Error('refusing to hash evidence for an outcome other than "Compensation paid"');
  const resultHash = hashEvidence(manifest);
  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(path.join(dir, 'status.json'), JSON.stringify(observed, null, 2));
  await writeFile(path.join(dir, 'result-hash.txt'), `${resultHash}\n`);
  return { resultHash, manifestPath };
}
