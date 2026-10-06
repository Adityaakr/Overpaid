import type { Page } from '@playwright/test';
import { guarded, Runner, toCents, type RecipeOpts, type RecipeResult } from './lib.js';

type Kind = 'duplicate_charge' | 'price_adjustment';
const FINAL: Record<Kind, string> = { duplicate_charge: 'refund_issued', price_adjustment: 'price_adjustment_issued' };

export async function cartwellSupport(page: Page, opts: RecipeOpts, recipe: string, kind: Kind, orderId: string, details: string): Promise<RecipeResult> {
  const r = new Runner(page, recipe, 'cartwell', opts);
  return guarded(r, async () => {
    await r.start('/');
    await r.click(page.getByTestId('nav-orders'), 'Orders');
    await r.click(page.getByTestId(`order-link-${orderId}`), `order ${orderId}`);
    const detail = page.locator(`[data-order-id="${orderId}"][data-charge-count]`);
    if (kind === 'duplicate_charge' && Number(await detail.getAttribute('data-charge-count')) < 2) {
      return r.failed(`order ${orderId} shows only one charge`);
    }
    await r.click(page.getByTestId('support-link'), 'Contact support');
    await r.select(page.getByTestId('support-reason'), kind, 'reason');
    await r.select(page.getByTestId('support-order'), orderId, 'order');
    await r.fill(page.getByTestId('support-details'), details, 'details');
    await r.check(page.getByTestId('support-store-credit'), false, '"Accept store credit instead" (want a card refund)');
    const ok = await r.irreversible(page.getByTestId('support-submit'), 'Submit support request', `${kind.replace('_', ' ')} request for ${orderId}`, null);
    if (!ok) return r.denied();

    const dup = page.getByTestId('duplicate-ticket');
    if ((await dup.count()) > 0) {
      const existing = await dup.getAttribute('data-ticket-id');
      await r.goto(`/support/tickets/${existing}`);
    }
    const ticket = () => page.getByTestId('ticket-status');
    if ((await ticket().count()) === 0) {
      const err = (await page.getByTestId('form-errors').textContent().catch(() => null)) ?? 'support form not accepted';
      return r.failed(err.trim());
    }
    const id = await ticket().getAttribute('data-ticket-id');
    const statusUrl = page.url();
    let status = await ticket().getAttribute('data-status');
    if (opts.waitForFinal) status = await r.waitForStatus(ticket, [FINAL[kind]]);
    const outcome = status === FINAL[kind] ? 'success' : status === 'under_review' ? (opts.waitForFinal ? 'pending' : 'success') : 'failed';
    return r.result({ outcome, confirmationCode: id, amountCents: toCents(await ticket().getAttribute('data-amount-cents')), merchantStatus: status, statusUrl });
  });
}
