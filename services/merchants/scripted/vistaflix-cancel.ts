import type { Page } from '@playwright/test';
import { guarded, Runner, toCents, type RecipeOpts, type RecipeResult } from './lib.js';

export type VistaflixCancelOpts = RecipeOpts & { planId: string };

/** Vistaflix: cancel one plan through Settings -> Manage plan -> pause -> offer -> survey -> confirm. */
export async function run(page: Page, opts: VistaflixCancelOpts): Promise<RecipeResult> {
  const r = new Runner(page, 'vistaflix-cancel', 'vistaflix', opts);
  return guarded(r, async () => {
    const { planId } = opts;
    await r.start('/');
    await r.click(page.getByTestId('nav-account'), 'Account');
    const row = () => page.getByTestId(`plan-row-${planId}`);
    if ((await row().count()) === 0) return r.failed(`plan ${planId} not found on account page`);
    if ((await row().getAttribute('data-status')) === 'cancelled') {
      // Already cancelled: report the merchant's existing confirmation (idempotent).
      return r.result({
        outcome: 'success',
        confirmationCode: await row().getAttribute('data-confirmation'),
        amountCents: toCents(await row().getAttribute('data-amount-cents')),
        merchantStatus: 'cancelled',
        statusUrl: page.url(),
      });
    }
    const amountCents = toCents(await row().getAttribute('data-amount-cents'));
    await r.click(page.getByTestId('settings-link'), 'Settings');
    await r.click(page.getByTestId(`manage-plan-${planId}`), 'Manage plan');
    await r.click(page.getByTestId('cancel-plan'), 'Cancel plan');
    await r.click(page.getByTestId('continue-cancel'), 'No thanks, continue to cancel (skip pause)');
    await r.click(page.getByTestId('decline-offer'), 'Decline 50% retention offer');
    await r.check(page.getByTestId('survey-reason-not_watching'), true, 'survey reason: not watching enough');
    await r.click(page.getByTestId('survey-submit'), 'Continue (survey)');
    const ok = await r.irreversible(page.getByTestId('confirm-cancellation'), 'Confirm cancellation', `Cancel Vistaflix plan ${planId}`, amountCents);
    if (!ok) return r.denied();
    const success = page.getByTestId('cancellation-success');
    if ((await success.count()) === 0) return r.failed('no cancellation confirmation page');
    const code = await success.getAttribute('data-confirmation');
    const statusUrl = page.url();
    // Verify on the account (status) page, as the verifier would.
    await r.goto('/account');
    const status = await row().getAttribute('data-status');
    return r.result({
      outcome: status === 'cancelled' ? 'success' : 'failed',
      confirmationCode: code,
      amountCents,
      merchantStatus: status,
      statusUrl,
    });
  });
}
