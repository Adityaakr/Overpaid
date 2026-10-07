import { createHash, randomBytes } from 'node:crypto';
import { coworkerCore } from './sokosumi.js';
import { confirmedState, mps, QUOTE, registration, USDM } from './mps.js';

const MINUTE = 60_000;
/** Direct Task payments hash the raw UTF-8 bytes (no nonce prefix). */
export const taskHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export interface Paid {
  stage: string;
  nonce?: string;
  request?: any;
  payment?: any;
  payload?: any;
  eventId?: string;
  observed?: any;
  result?: string;
  resultHash?: string;
  completionEventId?: string;
  settlement?: any;
}

/** Builds the masumiPayment event from MPS's signed terms without touching any signed field. */
export function purchasePayload(payment: any, nonce: string, reg: NonNullable<ReturnType<typeof registration>>) {
  if (payment.sellerReturnAddress !== null || (payment.forceLayer !== undefined && payment.forceLayer !== null)) throw new Error('Signed terms carry overrides Core cannot preserve');
  if (payment.PaymentSource?.network !== 'Preprod' || payment.PaymentSource?.paymentSourceType !== 'Web3CardanoV2') throw new Error('Payment source is not Preprod Web3CardanoV2');
  if (payment.SmartContractWallet?.id !== reg.walletId) throw new Error('Payment wallet differs from the seller wallet');
  if (payment.RequestedFunds.length !== 1 || payment.RequestedFunds[0].unit !== USDM || payment.RequestedFunds[0].amount !== QUOTE) throw new Error('Signed quote differs from the configured price');
  return {
    blockchainIdentifier: payment.blockchainIdentifier,
    agentIdentifier: payment.agentIdentifier,
    sellerVkey: payment.SmartContractWallet.walletVkey,
    submitResultTime: payment.submitResultTime,
    payByTime: payment.payByTime,
    unlockTime: payment.unlockTime,
    externalDisputeUnlockTime: payment.externalDisputeUnlockTime,
    inputHash: payment.inputHash,
    identifierFromPurchaser: nonce,
    paymentSourceType: 'Web3CardanoV2',
    supportedPaymentSourceIndex: reg.supportedPaymentSourceIndex,
    Amounts: payment.RequestedFunds.map(({ amount, unit }: any) => ({ amount, unit })),
    PaymentSource: { network: 'Preprod', smartContractAddress: payment.PaymentSource.smartContractAddress, policyId: payment.PaymentSource.policyId },
  };
}

/** Net test USDM the seller address gained in the collection transaction, measured from Blockfrost. */
async function verifySettlement(taskId: string, payment: any, sellerAddress: string) {
  const core = await coworkerCore();
  const receipt = (await core.get(`/v1/tasks/${encodeURIComponent(taskId)}/receipt`)).data;
  if (!receipt?.settled || !receipt.txHash) return { verified: false, receipt };
  if (receipt.blockchainIdentifier !== payment.blockchainIdentifier) throw new Error('Core receipt payment identifier mismatch');
  const tx = [payment.CurrentTransaction, ...(payment.TransactionHistory ?? [])].find((t: any) => t?.status === 'Confirmed' && ['Withdrawn', 'DisputedWithdrawn'].includes(t.newOnChainState) && t.txHash === receipt.txHash);
  if (!tx) return { verified: false, receipt, reason: 'matching MPS withdrawal not confirmed' };
  const bf = process.env.BLOCKFROST_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
  const r = await fetch(`${bf}/txs/${receipt.txHash}/utxos`, { headers: { project_id: process.env.BLOCKFROST_PROJECT_ID ?? '' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return { verified: false, receipt, blockfrostStatus: r.status };
  const u = (await r.json()) as any;
  const sum = (xs: any[]) => xs.filter((x) => x.address === sellerAddress).reduce((n, x) => n + x.amount.filter((a: any) => a.unit === USDM).reduce((m: bigint, a: any) => m + BigInt(a.quantity), 0n), 0n);
  const net = sum(u.outputs) - sum(u.inputs);
  return { verified: net > 0n, receipt, txHash: receipt.txHash, netAtomicUnits: net.toString(), sellerAddress, unit: USDM };
}

/**
 * One step of the paid flow per call. State is saved before every external write, and any stage
 * ending in -pending is an uncertain write: it is never retried automatically.
 */
export async function advancePaid(taskId: string, input: string, paid: Paid | undefined, save: (p: Paid) => void, answer: (input: string, deadline: number) => Promise<string>): Promise<{ paid: Paid; completed?: boolean }> {
  const reg = registration();
  if (!reg) throw new Error('No confirmed registration');
  let p: Paid = paid ?? { stage: '' };
  const put = (next: Paid) => (save(next), (p = next));

  if (!p.stage) {
    if (!input.trim()) throw new Error('Paid Task requires input');
    const nonce = randomBytes(10).toString('hex');
    const now = Date.now();
    const request = {
      network: 'Preprod',
      agentIdentifier: reg.agentIdentifier,
      paymentSourceType: 'Web3CardanoV2',
      supportedPaymentSourceIndex: reg.supportedPaymentSourceIndex,
      inputHash: taskHash(input),
      identifierFromPurchaser: nonce,
      RequestedFunds: [{ amount: QUOTE, unit: USDM }],
      // Pay-by leaves room for the payment node's chain sync to see the lock before its timeout job runs.
      payByTime: new Date(now + 10 * MINUTE).toISOString(),
      submitResultTime: new Date(now + 25 * MINUTE).toISOString(),
      unlockTime: new Date(now + 40 * MINUTE).toISOString(),
      externalDisputeUnlockTime: new Date(now + 56 * MINUTE).toISOString(),
      metadata: JSON.stringify({ taskId }),
    };
    put({ stage: 'terms-pending', nonce, request });
    const payment = await mps('/payment', request);
    return { paid: put({ ...p, stage: 'terms-saved', payment }) };
  }
  if (p.stage === 'terms-saved') {
    const payload = purchasePayload(p.payment, p.nonce!, reg);
    if (Date.now() >= Number(p.payment.payByTime)) throw new Error('Signed pay-by deadline passed');
    put({ ...p, payload, stage: 'purchase-pending' });
    const res = await (await coworkerCore()).post(`/v1/tasks/${encodeURIComponent(taskId)}/events`, { comment: `Payment requested: ${Number(QUOTE) / 1e6} test USDM into Masumi escrow.`, masumiPayment: payload });
    return { paid: put({ ...p, stage: 'awaiting-escrow', eventId: res.data.id }) };
  }
  if (['awaiting-escrow', 'awaiting-result', 'awaiting-withdrawal'].includes(p.stage)) {
    const observed = await mps('/payment/resolve-blockchain-identifier', { network: 'Preprod', blockchainIdentifier: p.payment.blockchainIdentifier, includeHistory: 'true' });
    put({ ...p, observed });
    if (p.stage === 'awaiting-escrow') {
      if (observed.onChainState === 'FundsOrDatumInvalid' || observed.NextAction?.requestedAction === 'WaitingForManualAction') {
        // Terminal for this Task: the escrow refunds the buyer after the deadline. Never run the work unpaid.
        put({ ...p, stage: 'payment-failed-pending' });
        const note = `Payment could not be confirmed (${observed.NextAction?.errorNote ?? observed.onChainState}). No work was delivered; the escrow returns the funds to the buyer after its deadline.`;
        await (await coworkerCore()).post(`/v1/tasks/${encodeURIComponent(taskId)}/events`, { status: 'FAILED', comment: note });
        return { paid: put({ ...p, stage: 'payment-failed' }) };
      }
      if (observed.onChainState !== 'FundsLocked' || !confirmedState(observed, 'FundsLocked')) return { paid: p };
      const deadline = Number(p.payment.submitResultTime);
      if (Date.now() >= deadline) throw new Error('Result deadline passed before the model ran');
      put({ ...p, stage: 'model-pending' });
      const result = await answer(input, deadline);
      if (!result.trim()) throw new Error('Empty result');
      return { paid: put({ ...p, stage: 'result-saved', result, resultHash: taskHash(result) }) };
    }
    if (p.stage === 'awaiting-result' && observed.onChainState === 'ResultSubmitted' && observed.resultHash === p.resultHash && confirmedState(observed, 'ResultSubmitted')) return { paid: put({ ...p, stage: 'complete-ready' }) };
    if (p.stage === 'awaiting-withdrawal' && ['Withdrawn', 'DisputedWithdrawn'].includes(observed.onChainState)) {
      const settlement = await verifySettlement(taskId, observed, reg.sellerAddress);
      return { paid: put({ ...p, stage: settlement.verified ? 'settled' : 'awaiting-withdrawal', settlement }) };
    }
    return { paid: p };
  }
  if (p.stage === 'result-saved') {
    if (Date.now() >= Number(p.payment.submitResultTime)) throw new Error('Result deadline passed before submit');
    put({ ...p, stage: 'submit-pending' });
    await mps('/payment/submit-result', { network: 'Preprod', blockchainIdentifier: p.payment.blockchainIdentifier, submitResultHash: p.resultHash });
    return { paid: put({ ...p, stage: 'awaiting-result' }) };
  }
  if (p.stage === 'complete-ready') {
    put({ ...p, stage: 'complete-pending' });
    const res = await (await coworkerCore()).post(`/v1/tasks/${encodeURIComponent(taskId)}/events`, { status: 'COMPLETED', comment: p.result });
    return { paid: put({ ...p, stage: 'awaiting-withdrawal', completionEventId: res.data.id }), completed: true };
  }
  if (p.stage === 'payment-failed') return { paid: p };
  if (p.stage.endsWith('-pending')) throw new Error(`Uncertain ${p.stage}; inspect before recovery`);
  return { paid: p };
}
