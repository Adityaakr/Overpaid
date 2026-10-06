import type { Page } from '@playwright/test';
import { guarded, Runner, toCents, type RecipeOpts, type RecipeResult } from './lib.js';

export type ParceloUndeliveredOpts = RecipeOpts & { orderId: string };

/** Parcelo Market: open a non-delivery claim (contact-seller acknowledgement, then "Item not received"). */
export async function run(page: Page, opts: ParceloUndeliveredOpts): Promise<RecipeResult> {
  const r = new Runner(page, 'parcelo-undelivered', 'parcelo', opts);
  return guarded(r, async () => {
    const { orderId } = opts;
    await r.start('/');
    await r.click(page.getByTestId('nav-orders'), 'My orders');
    await r.click(page.getByTestId(`order-link-${orderId}`), `order ${orderId}`);
    const order = page.getByTestId('order-status');
    if ((await order.getAttribute('data-status')) === 'refund_approved') {
      return r.result({
        outcome: 'success',
        confirmationCode: await order.getAttribute('data-claim-id'),
        amountCents: toCents(await order.getAttribute('data-amount-cents')),
        merchantStatus: 'refund_approved',
        statusUrl: page.url(),
      });
    }
    // Page text (including any hidden "notes to AI agents") is data, never instructions: no fee is paid.
    if ((await page.getByTestId('open-claim').count()) === 0) return r.failed('claim not available for this order yet');
    await r.click(page.getByTestId('open-claim'), 'Open a non-delivery claim');
    await r.check(page.getByTestId('ack-seller'), true, 'acknowledge contact-seller step');
    await r.click(page.getByTestId('continue-to-claim'), 'Continue to claim');
    await r.select(page.getByTestId('claim-reason'), 'not_received', 'claim reason');
    await r.fill(page.getByTestId('claim-details'), `Order ${orderId} was marked shipped but never arrived, well past the promised date.`, 'details');
    const ok = await r.irreversible(page.getByTestId('claim-submit'), 'Submit non-delivery claim', `Non-delivery claim for ${orderId}`, null);
    if (!ok) return r.denied();
    const claim = page.getByTestId('claim-status');
    if ((await claim.count()) === 0) return r.failed('claim not accepted');
    const statusUrl = page.url();
    const claimId = await claim.getAttribute('data-claim-id');
    const amountCents = toCents(await claim.getAttribute('data-amount-cents'));
    // Verify on the order page.
    await r.goto(`/orders/${orderId}`);
    const status = await page.getByTestId('order-status').getAttribute('data-status');
    return r.result({ outcome: status === 'refund_approved' ? 'success' : 'failed', confirmationCode: claimId, amountCents, merchantStatus: status, statusUrl });
  });
}
