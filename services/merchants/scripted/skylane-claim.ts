import type { Page } from '@playwright/test';
import { DEMO_USER, SKYLANE_FLIGHT } from '@overpaid/shared';
import { guarded, Runner, toCents, type RecipeOpts, type RecipeResult } from './lib.js';

export type SkylaneClaimOpts = RecipeOpts & {
  bookingRef?: string;
  passengerName?: string;
  /** Override the delay category instead of reading it from the booking's disruption details (used by negative tests). */
  delayCategory?: string;
  payout?: 'original_card' | 'bank_transfer' | 'voucher';
};

/** Skylane Air: file a delay compensation claim with the delay category recorded on the booking. */
export async function run(page: Page, opts: SkylaneClaimOpts): Promise<RecipeResult> {
  const r = new Runner(page, 'skylane-claim', 'skylane', opts);
  return guarded(r, async () => {
    const ref = opts.bookingRef ?? SKYLANE_FLIGHT.bookingRef;
    await r.start('/');
    await r.click(page.getByTestId('nav-manage'), 'Manage booking');
    await r.click(page.getByTestId(`booking-link-${ref}`), `booking ${ref}`);
    const existing = page.getByTestId('existing-claim');
    if ((await existing.count()) > 0) {
      await r.click(existing, 'existing claim');
    } else {
      const category = opts.delayCategory ?? ((await page.getByTestId('delay-reason').textContent()) ?? '').trim();
      r.record(`read delay category "${category}"`);
      await r.click(page.getByTestId('claim-compensation-link'), 'Claim compensation');
      await r.fill(page.getByTestId('claim-booking-ref'), ref, 'booking reference');
      await r.fill(page.getByTestId('claim-passenger-name'), opts.passengerName ?? DEMO_USER.name, 'passenger name');
      await r.select(page.getByTestId('claim-delay-category'), category, 'delay category');
      await r.check(page.getByTestId(`claim-payout-${opts.payout ?? 'original_card'}`), true, 'payout method');
      await r.check(page.getByTestId('claim-declaration'), true, 'declaration');
      const ok = await r.irreversible(page.getByTestId('claim-submit'), 'Submit compensation claim', `Delay compensation claim for ${ref}`, SKYLANE_FLIGHT.compensation);
      if (!ok) return r.denied();
      const rejected = page.getByTestId('claim-rejected');
      if ((await rejected.count()) > 0) {
        const res = r.failed(((await rejected.textContent()) ?? 'rejected').replace(/\s+/g, ' ').trim());
        return { ...res, merchantStatus: 'rejected' };
      }
    }
    const claim = () => page.getByTestId('claim-status');
    if ((await claim().count()) === 0) return r.failed('no claim status page');
    const claimId = await claim().getAttribute('data-claim-id');
    const statusUrl = page.url();
    let status = await claim().getAttribute('data-status');
    if (opts.waitForFinal) status = await r.waitForStatus(claim, ['paid', 'voucher_issued']);
    const final = status === 'paid' || status === 'voucher_issued';
    return r.result({
      outcome: final || (status === 'approved' && !opts.waitForFinal) ? 'success' : status === 'approved' ? 'pending' : 'failed',
      confirmationCode: claimId,
      amountCents: toCents(await claim().getAttribute('data-amount-cents')),
      merchantStatus: status,
      statusUrl,
    });
  });
}
