/**
 * x402 plumbing shared by the specialist (seller) and Overpaid (buyer):
 *  - an in-process facilitator with no keys (verify + broadcast the buyer's signed tx; research x402-facilitator §4);
 *  - a framework-agnostic paid-route runner on @x402/core's x402HTTPResourceServer (we use Fastify, and
 *    @x402/express is Express-only): verify -> handler (must not touch chain) -> settle -> respond;
 *  - a direct default-method payment (no HTTP) for scripts/check-x402.ts.
 */
import { x402Facilitator } from '@x402/core/facilitator';
import { x402Client } from '@x402/core/client';
import type { FacilitatorClient, HTTPAdapter, HTTPRequestContext, x402HTTPResourceServer } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from '@x402/core/types';
import { ExactCardanoScheme as ClientScheme } from '@x402/cardano/exact/client';
import { ExactCardanoScheme as FacilitatorScheme } from '@x402/cardano/exact/facilitator';
import { decodeCardanoTransaction, toFacilitatorCardanoSigner, type MasumiRegistryValidator } from '@x402/cardano';
import { NETWORK } from './constants.js';
import type { BlockfrostConfig } from './env.js';
import type { NamedAccount } from './wallets.js';

export interface InProcessFacilitatorOptions {
  validateRegistryClaim?: MasumiRegistryValidator;
  confirmationTimeoutMs?: number;
}

/** The keyless facilitator, shaped as the FacilitatorClient the resource server expects. */
export function inProcessFacilitator(bf: BlockfrostConfig, opts: InProcessFacilitatorOptions = {}): FacilitatorClient {
  const f = new x402Facilitator().register(
    NETWORK,
    new FacilitatorScheme(
      toFacilitatorCardanoSigner({ network: NETWORK, provider: { blockfrost: bf, requestTimeoutMs: 20_000 }, awaitConfirmation: false }),
      { ...(opts.validateRegistryClaim ? { validateRegistryClaim: opts.validateRegistryClaim } : {}), confirmationTimeoutMs: opts.confirmationTimeoutMs ?? 120_000 },
    ),
  );
  return {
    verify: (p, r) => f.verify(p, r) as Promise<VerifyResponse>,
    settle: (p, r) => f.settle(p, r) as Promise<SettleResponse>,
    getSupported: async () => f.getSupported() as Awaited<ReturnType<FacilitatorClient['getSupported']>>,
  };
}

// ---------------------------------------------------------------- paid route runner

export interface PlainRequest {
  method: string;
  /** Path without query string. */
  path: string;
  /** Absolute URL as the client sees it. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[]>;
  body?: unknown;
}

export interface PlainResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface PaidContext {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  /** The payment tx hash, known before broadcast. */
  txHash: string;
}

const h1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function adapterFor(req: PlainRequest): HTTPAdapter & { getBody(): unknown } {
  const header = (name: string) => h1(req.headers[name.toLowerCase()]);
  return {
    getHeader: header,
    getMethod: () => req.method,
    getPath: () => req.path,
    getUrl: () => req.url,
    getAcceptHeader: () => header('accept') ?? '',
    getUserAgent: () => header('user-agent') ?? '',
    getQueryParams: () => req.query ?? {},
    getQueryParam: (n: string) => req.query?.[n],
    getBody: () => req.body,
  };
}

/**
 * Run one request through the x402 gate. Unpaid -> the 402 (with a fresh seller-signed Masumi quote). Paid ->
 * verify, then `handler` (it runs BEFORE settle, so it must only record state), then settle; the handler's
 * response is released only if settlement succeeds.
 */
export async function runPaidRoute(
  http: x402HTTPResourceServer,
  req: PlainRequest,
  handler: (ctx: PaidContext) => Promise<{ status?: number; body: unknown }>,
  onSettled?: (ctx: PaidContext, settle: SettleResponse) => Promise<void> | void,
): Promise<PlainResponse> {
  const adapter = adapterFor(req);
  const context: HTTPRequestContext = {
    adapter, path: req.path, method: req.method,
    paymentHeader: adapter.getHeader('payment-signature') || adapter.getHeader('x-payment'),
  };
  if (!http.requiresPayment(context)) return { status: 500, headers: {}, body: { error: 'route is not payment-gated' } };
  const result = await http.processHTTPRequest(context);
  if (result.type === 'no-payment-required') return { status: 500, headers: {}, body: { error: 'route is not payment-gated' } };
  if (result.type === 'payment-error') {
    return { status: result.response.status, headers: result.response.headers, body: result.response.body ?? {} };
  }
  const { paymentPayload, paymentRequirements, declaredExtensions, beforeHandlerSettlement, cancellationDispatcher } = result;
  const txHash = decodeCardanoTransaction(String((paymentPayload.payload as { transaction: string }).transaction)).txHash;
  const ctx: PaidContext = { payload: paymentPayload, requirements: paymentRequirements, txHash };
  let out: { status?: number; body: unknown };
  try {
    out = await handler(ctx);
  } catch (error) {
    await cancellationDispatcher.cancel({ reason: 'handler_threw', error });
    return { status: 500, headers: {}, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  const status = out.status ?? 200;
  if (status >= 400) {
    await cancellationDispatcher.cancel({ reason: 'handler_failed', responseStatus: status });
    return { status, headers: {}, body: out.body };
  }
  const responseBody = Buffer.from(JSON.stringify(out.body));
  const settle = await http.processSettlement(paymentPayload, paymentRequirements, declaredExtensions,
    { request: context, responseBody, responseHeaders: { 'content-type': 'application/json' } }, undefined, beforeHandlerSettlement);
  if (!settle.success) {
    return { status: settle.response.status, headers: settle.response.headers, body: settle.response.body ?? {} };
  }
  await onSettled?.(ctx, settle);
  return { status, headers: { ...settle.headers, 'cache-control': 'private, no-store' }, body: out.body };
}

// ---------------------------------------------------------------- direct default-method payment

/** Pay `amount` lovelace from `payer` to `payTo` with the x402 `default` method through the in-process facilitator. */
export async function payDefaultDirect(payer: NamedAccount, payTo: string, amountLovelace: bigint, bf: BlockfrostConfig, l1Confirmations = 1) {
  const requirements: PaymentRequirements = {
    scheme: 'exact', network: NETWORK, asset: 'lovelace', amount: amountLovelace.toString(), payTo, maxTimeoutSeconds: 300,
    extra: { assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations } },
  };
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ClientScheme(payer.x402ClientSigner(bf)) }],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: 'lovelace', maxAmountPerPayment: amountLovelace.toString() }] },
  });
  const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url: 'urn:overpaid:check-x402', description: 'check', mimeType: 'application/json' }, accepts: [requirements] });
  const txHash = decodeCardanoTransaction(String((payload.payload as { transaction: string }).transaction)).txHash;
  const facilitator = inProcessFacilitator(bf);
  const verify = await facilitator.verify(payload, payload.accepted);
  if (!verify.isValid) throw new Error(`x402 verify rejected: ${verify.invalidReason ?? 'unknown'} ${verify.invalidMessage ?? ''}`);
  const settle = await facilitator.settle(payload, payload.accepted);
  return { txHash, verify, settle };
}
