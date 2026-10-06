import type { Locator, Page } from '@playwright/test';
import { merchantUrl, type MerchantKey } from '@overpaid/shared';

export type Step = { url: string; action: string };

export type Outcome =
  /** The irreversible step was performed and the merchant confirmed it (and the final status was reached if waitForFinal). */
  | 'success'
  /** Submitted and confirmed, but the final status (e.g. "Refund issued") was not reached before finalTimeoutMs. */
  | 'pending'
  /** requestApproval returned false; nothing irreversible was done. */
  | 'approval_denied'
  /** The merchant rejected the request or the page did not behave as expected. */
  | 'failed';

export type RecipeResult = {
  outcome: Outcome;
  /** Merchant-issued id: cancellation code, ticket id or claim id. */
  confirmationCode: string | null;
  amountCents: number | null;
  /** The merchant's own machine-readable status (data-status) at the end of the run. */
  merchantStatus: string | null;
  /** URL of the merchant page that proves the outcome (for the verifier). */
  statusUrl: string | null;
  error?: string;
  steps: Step[];
};

export type ApprovalRequest = {
  recipe: string;
  merchant: MerchantKey;
  action: string;
  description: string;
  url: string;
  amountCents: number | null;
};

export type RecipeOpts = {
  /** Called right before each irreversible click. Return true to proceed. */
  requestApproval: (req: ApprovalRequest) => Promise<boolean>;
  /** Defaults to merchantUrl(merchant) from @overpaid/shared. */
  baseUrl?: string;
  /** Inject the demo session cookie into the page's context first (default true). */
  injectSession?: boolean;
  /** Keep reloading the status page until the final status appears (default false). */
  waitForFinal?: boolean;
  finalTimeoutMs?: number;
  /** Per-action timeout (default 10s). */
  actionTimeoutMs?: number;
};

export class RecipeFailure extends Error {}

export class Runner {
  readonly steps: Step[] = [];
  readonly base: string;
  constructor(
    readonly page: Page,
    readonly recipe: string,
    readonly merchant: MerchantKey,
    readonly opts: RecipeOpts,
  ) {
    this.base = (opts.baseUrl ?? merchantUrl(merchant)).replace(/\/$/, '');
    page.setDefaultTimeout(opts.actionTimeoutMs ?? 10_000);
  }

  async start(path: string): Promise<void> {
    if (this.opts.injectSession !== false) {
      await this.page.context().addCookies([{ name: 'demo_session', value: 'alex-demo', url: this.base }]);
    }
    await this.goto(path);
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(this.base + path);
    this.record(`navigate ${path}`);
    if ((await this.page.getByTestId('demo-login').count()) > 0) {
      await this.click(this.page.getByTestId('demo-login'), 'sign in with the demo account');
    }
  }

  record(action: string): void {
    this.steps.push({ url: this.page.url(), action });
  }

  async click(loc: Locator, label: string): Promise<void> {
    this.record(`click ${label}`);
    // Playwright waits for a navigation started by the click to begin; then wait for the new page to load.
    await loc.click();
    await this.page.waitForLoadState('load');
  }

  async fill(loc: Locator, value: string, label: string): Promise<void> {
    this.record(`type ${label}`);
    await loc.fill(value);
  }

  async select(loc: Locator, value: string, label: string): Promise<void> {
    this.record(`select ${label} = ${value}`);
    await loc.selectOption(value);
  }

  async check(loc: Locator, on: boolean, label: string): Promise<void> {
    this.record(`${on ? 'check' : 'uncheck'} ${label}`);
    await loc.setChecked(on);
  }

  /** Ask for approval, then perform the irreversible click. Returns false if denied. */
  async irreversible(loc: Locator, action: string, description: string, amountCents: number | null): Promise<boolean> {
    const ok = await this.opts.requestApproval({ recipe: this.recipe, merchant: this.merchant, action, description, url: this.page.url(), amountCents });
    this.record(ok ? `approval granted: ${action}` : `approval denied: ${action}`);
    if (!ok) return false;
    await this.click(loc, `${action} (irreversible)`);
    return true;
  }

  /** Reload until `loc`'s data-status is one of `finals`, or time out. */
  async waitForStatus(loc: () => Locator, finals: string[]): Promise<string | null> {
    const deadline = Date.now() + (this.opts.finalTimeoutMs ?? 120_000);
    let status = await loc().getAttribute('data-status');
    while (!finals.includes(status ?? '') && Date.now() < deadline) {
      await this.page.waitForTimeout(1000);
      await this.page.reload();
      status = await loc().getAttribute('data-status');
    }
    this.record(`observed status ${status}`);
    return status;
  }

  result(partial: Omit<RecipeResult, 'steps'>): RecipeResult {
    return { ...partial, steps: this.steps };
  }

  denied(): RecipeResult {
    return this.result({ outcome: 'approval_denied', confirmationCode: null, amountCents: null, merchantStatus: null, statusUrl: null });
  }

  failed(error: string): RecipeResult {
    return this.result({ outcome: 'failed', confirmationCode: null, amountCents: null, merchantStatus: null, statusUrl: this.page.url(), error });
  }
}

export const toCents = (s: string | null): number | null => (s === null || s === '' ? null : Number(s));

/** Wrap a recipe so unexpected Playwright errors become a 'failed' result instead of a throw. */
export async function guarded(r: Runner, fn: () => Promise<RecipeResult>): Promise<RecipeResult> {
  try {
    return await fn();
  } catch (err) {
    return r.failed(err instanceof Error ? err.message : String(err));
  }
}
