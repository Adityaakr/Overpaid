import type { Page } from '@playwright/test';
import { cartwellSupport } from './cartwell-common.js';
import type { RecipeOpts, RecipeResult } from './lib.js';

export type CartwellPriceAdjustOpts = RecipeOpts & { orderId: string };

/** Cartwell: claim a price-protection adjustment for an order whose price dropped within 14 days. */
export async function run(page: Page, opts: CartwellPriceAdjustOpts): Promise<RecipeResult> {
  return cartwellSupport(page, opts, 'cartwell-price-adjust', 'price_adjustment', opts.orderId,
    `The price of order ${opts.orderId} dropped within the 14-day price protection window. Please refund the difference.`);
}
