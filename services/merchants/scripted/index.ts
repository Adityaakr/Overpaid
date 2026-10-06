// Scripted Playwright fallback for each demo recipe. Each run() calls opts.requestApproval right before
// the irreversible click and returns { outcome, confirmationCode, amountCents, merchantStatus, statusUrl, steps }.
export * from './lib.js';
export { run as vistaflixCancel } from './vistaflix-cancel.js';
export { run as cartwellDuplicate } from './cartwell-duplicate.js';
export { run as cartwellPriceAdjust } from './cartwell-price-adjust.js';
export { run as parceloUndelivered } from './parcelo-undelivered.js';
export { run as skylaneClaim } from './skylane-claim.js';
