import type { Page } from '@playwright/test';
import { cartwellSupport } from './cartwell-common.js';
import type { RecipeOpts, RecipeResult } from './lib.js';

export type CartwellDuplicateOpts = RecipeOpts & { orderId?: string };

/** Cartwell: request a refund of the duplicate charge on CW-4417 (or opts.orderId). */
export async function run(page: Page, opts: CartwellDuplicateOpts): Promise<RecipeResult> {
  const orderId = opts.orderId ?? 'CW-4417';
  return cartwellSupport(page, opts, 'cartwell-duplicate', 'duplicate_charge', orderId,
    `Order ${orderId} was charged twice to my Visa ending 4417. Please refund the duplicate charge.`);
}
