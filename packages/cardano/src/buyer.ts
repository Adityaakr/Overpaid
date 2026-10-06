/**
 * Buyer side: hire a specialist over x402 `masumi` (escrow lock into vested_pay v2), then optionally dispute/refund.
 *
 * Checks we add on top of the reference signer (research x402-masumi "Gotchas" 3-5):
 *  - the quote's inputCommitment content deep-equals (canonical JSON) the body we POSTed;
 *  - payTo is the canonical preprod escrow, network is preprod, asset is lovelace, price <= our cap;
 *  - `resource` is passed to the signer (2.26's client scheme drops it, which breaks registered offers).
 * Input hash = SHA-256 hex of the canonical (RFC 8785) task spec. The on-chain datum `input_hash` is x402's
 * domain-separated commitment digest; both are returned.
 */
import { randomBytes } from 'node:crypto';
import { canonicalJson, hashCanonical } from '@overpaid/shared';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { PaymentRequired, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { ExactCardanoScheme as ClientScheme } from '@x402/cardano/exact/client';
import { decodeBlockchainIdentifier, decodeCardanoTransaction, type CardanoExtraMasumi, type ClientCardanoSigner } from '@x402/cardano';
import { ESCROW_ADDRESS, NETWORK, txUrl } from './constants.js';
import { requireBlockfrost, type BlockfrostConfig } from './env.js';
import { blockfrost, type Blockfrost } from './provider.js';
import type { NamedAccount } from './wallets.js';
import { setRefundRequested as setRefundRequestedTx, withdrawRefund as withdrawRefundTx, type ActionOptions } from './escrow/actions.js';

export const SPECIALIST_PAID_PATH = '/x402/start_job';

export class HireError extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HireError';
  }
}

export interface HireRequest {
  /** Base URL of the specialist, e.g. http://localhost:4200 */
  specialistUrl: string;
  /** The canonical task spec (becomes MIP-003 input_data). */
  task: Record<string, unknown>;
  buyer: NamedAccount;
  /** Refuse quotes above this many lovelace (default 10 tADA). */
  maxPriceLovelace?: bigint;
  /** 14-64 lowercase even-length hex (MIP-003). Random 10 bytes by default. */
  identifierFromPurchaser?: string;
  blockfrost?: BlockfrostConfig;
  fetchImpl?: typeof fetch;
}

export interface HireResult {
  jobId: string | null;
  blockchainIdentifier: string;
  txLock: string;
  txLockUrl: string;
  payBy: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  /** SHA-256 hex of the canonical task spec (ours). */
  inputHash: string;
  /** The datum's input_hash: x402's commitment digest over the job body. */
  onchainInputHash: string;
  identifierFromPurchaser: string;
  sellerAddress: string;
  amountLovelace: string;
  settlement: SettleResponse | null;
  specialistResponse: unknown;
}

export const taskInputHash = (task: unknown) => hashCanonical(task);

/** Pick the masumi requirement and verify it commits to exactly our body. Pure; exported for tests. */
export function checkMasumiQuote(required: PaymentRequired, body: unknown, maxPrice: bigint): PaymentRequirements {
  const masumi = required.accepts.filter((r) => (r.extra as { assetTransferMethod?: string } | undefined)?.assetTransferMethod === 'masumi');
  if (masumi.length !== 1) throw new HireError(`expected exactly one masumi offer, got ${masumi.length}`);
  const r = masumi[0]!;
  if (r.network !== NETWORK) throw new HireError(`offer network ${r.network} is not ${NETWORK}`);
  if (r.payTo !== ESCROW_ADDRESS) throw new HireError(`offer payTo ${r.payTo} is not the canonical vested_pay v2 escrow`);
  if (r.asset !== 'lovelace') throw new HireError(`offer asset ${r.asset} is not lovelace (tADA)`);
  if (BigInt(r.amount) > maxPrice) throw new HireError(`price ${r.amount} lovelace exceeds cap ${maxPrice}`);
  const extra = r.extra as unknown as CardanoExtraMasumi;
  if ((extra as { deployment?: unknown }).deployment) throw new HireError('offer uses a non-canonical Masumi deployment');
  const parts = extra.inputCommitment?.parts ?? [];
  if (parts.length !== 1 || parts[0]!.canonicalization !== 'jcs') throw new HireError('offer commitment must be exactly one jcs part');
  if (canonicalJson(parts[0]!.content) !== canonicalJson(body)) {
    throw new HireError('offer commitment content does not equal the job body we sent');
  }
  if (extra.terms.inputHash !== extra.inputCommitment.digest) throw new HireError('terms.inputHash != commitment digest');
  return r;
}

/** Wrap a client signer so the protected `resource` reaches verifyMasumiAuthorization (registered offers). */
export function withResource(inner: ClientCardanoSigner, resource: PaymentRequired['resource']): ClientCardanoSigner {
  return {
    getAddress: () => inner.getAddress(),
    buildAndSignPaymentTransaction: (input) => inner.buildAndSignPaymentTransaction({ ...input, resource: input.resource ?? resource }),
  };
}

export async function hireSpecialist(req: HireRequest): Promise<HireResult> {
  const bf = req.blockfrost ?? requireBlockfrost();
  const doFetch = req.fetchImpl ?? fetch;
  const maxPrice = req.maxPriceLovelace ?? 10_000_000n;
  const identifier = req.identifierFromPurchaser ?? randomBytes(10).toString('hex');
  if (!/^([0-9a-f]{2}){7,32}$/.test(identifier)) throw new HireError('identifierFromPurchaser must be 14-64 lowercase even-length hex');
  const body = { identifier_from_purchaser: identifier, input_data: req.task };
  const url = `${req.specialistUrl.replace(/\/+$/, '')}${SPECIALIST_PAID_PATH}`;
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };

  const first = await doFetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (first.status !== 402) throw new HireError(`expected 402 from ${url}, got ${first.status}: ${(await first.text()).slice(0, 300)}`);
  const firstBody = await first.json().catch(() => ({}));

  const baseSigner = req.buyer.x402ClientSigner(bf);
  let required!: PaymentRequired;
  const signer: ClientCardanoSigner = {
    getAddress: () => baseSigner.getAddress(),
    buildAndSignPaymentTransaction: (input) => withResource(baseSigner, required.resource).buildAndSignPaymentTransaction(input),
  };
  const http = new x402HTTPClient(
    x402Client.fromConfig({
      schemes: [{ network: NETWORK, client: new ClientScheme(signer) }],
      spendControls: { allowedAssets: [{ network: NETWORK, asset: 'lovelace', maxAmountPerPayment: maxPrice.toString() }] },
      policies: [(_v, offers) => offers.filter((o) => (o.extra as { assetTransferMethod?: string } | undefined)?.assetTransferMethod === 'masumi' && o.payTo === ESCROW_ADDRESS)],
    }),
  );
  required = http.getPaymentRequiredResponse((n) => first.headers.get(n), firstBody);
  const chosen = checkMasumiQuote(required, body, maxPrice);
  const extra = chosen.extra as unknown as CardanoExtraMasumi;
  if (extra.terms.sellerAddress === req.buyer.address) throw new HireError('buyer and seller must be different wallets');

  const payload = await http.createPaymentPayload({ ...required, accepts: [chosen] });
  const txLock = decodeCardanoTransaction(String((payload.payload as { transaction: string }).transaction)).txHash;
  const paid = await doFetch(url, { ...init, headers: { ...init.headers, ...http.encodePaymentSignatureHeader(payload) }, signal: AbortSignal.timeout(240_000) });
  let settlement: SettleResponse | null = null;
  try {
    settlement = http.getPaymentSettleResponse((n) => paid.headers.get(n));
  } catch {
    settlement = null;
  }
  const specialistResponse = await paid.json().catch(() => null);
  const t = extra.terms;
  const result: HireResult = {
    jobId: (specialistResponse as { job_id?: string } | null)?.job_id ?? null,
    blockchainIdentifier: extra.blockchainIdentifier,
    txLock, txLockUrl: txUrl(txLock),
    payBy: Number(t.payByTime), submitResultTime: Number(t.submitResultTime), unlockTime: Number(t.unlockTime),
    externalDisputeUnlockTime: Number(t.externalDisputeUnlockTime),
    inputHash: taskInputHash(req.task), onchainInputHash: t.inputHash, identifierFromPurchaser: identifier,
    sellerAddress: t.sellerAddress, amountLovelace: chosen.amount, settlement, specialistResponse,
  };
  if (paid.status !== 200) {
    // settlement_pending: the lock may still land; the caller must watch txLock before re-paying.
    throw new HireError(`paid request returned ${paid.status}`, { ...result, settlement, specialistResponse });
  }
  return result;
}

export interface EscrowHandle {
  txLock: string;
  blockchainIdentifier?: string;
}

const refSig = (h: EscrowHandle) => (h.blockchainIdentifier ? decodeBlockchainIdentifier(h.blockchainIdentifier)?.referenceSignature : undefined);

/** Buyer: SetRefundRequested before unlockTime (opens a dispute if a result was submitted; irreversible). */
export async function requestRefund(buyer: NamedAccount, h: EscrowHandle, opts: ActionOptions & { bf?: Blockfrost } = {}) {
  return setRefundRequestedTx(buyer, { txHash: h.txLock, referenceSignature: refSig(h) }, { ...opts, bf: opts.bf ?? blockfrost() });
}

/** Buyer: WithdrawRefund (no result hash; after submitResultTime, or anytime once RefundAuthorized). */
export async function withdrawRefund(buyer: NamedAccount, h: EscrowHandle, opts: ActionOptions & { bf?: Blockfrost } = {}) {
  return withdrawRefundTx(buyer, { txHash: h.txLock, referenceSignature: refSig(h) }, { ...opts, bf: opts.bf ?? blockfrost() });
}
