export { runFind, type FindFile, type FindInput, type FindOptions } from './run.js';
export * from './types.js';
export { redact } from './redact.js';
export { DESCRIPTOR_RULES, cleanDescriptor, normaliseDescriptor, normaliseSender, normaliseWithModel, type ModelNormaliser, type MerchantIdentity } from './normalise.js';
export { parseEmail, classifyEmail, extractFields, keyValues, parseDuration } from './parse/email.js';
export { parseMbox } from './parse/mbox.js';
export { parseStatementCsv, rowsFromTable, toTransactions, refFromDescriptor, type StatementRow } from './parse/statement.js';
export { parseStatementPdf } from './parse/pdf.js';
export { findSchedules, getApproxNumberThreshold, type RecurringInput, type RecurringSchedule } from './recurring.js';
export { buildSubscriptions } from './subscriptions.js';
export { loadPolicies, PolicyLibrary, MerchantPolicy } from './policies.js';
export {
  DETECTORS,
  forgottenSubscription,
  duplicateCharge,
  priceDrop,
  undeliveredOrder,
  flightCompensation,
  billAboveMarket,
  type Detector,
  type DetectorContext,
} from './detectors.js';
