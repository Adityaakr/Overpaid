import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactCardanoScheme as ClientScheme } from '@x402/cardano/exact/client';
import { verifyMasumiAuthorization, type CardanoExtraMasumi } from '@x402/cardano';
import { checkMasumiQuote, ESCROW_ADDRESS, taskInputHash } from '@overpaid/cardano';
import { buildApp } from '../src/app.js';
import { makeOffer } from '../src/offer.js';
import { MemoryJobStore } from '../src/store.js';
import { BODY, offlineBuyerSigner, SELLER, stubFacilitator, TASK, testConfig } from './helpers.js';

const cfg = testConfig();
const store = new MemoryJobStore();
const fac = stubFacilitator();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const offer = await makeOffer(cfg, { seller: SELLER.masumiSeller(), facilitator: fac });
  app = await buildApp({ cfg, store, offer, sellerAddress: SELLER.address, watcher: null, chainReady: false });
});
afterAll(async () => app.close());

const paidUrl = '/x402/start_job';

describe('MIP-003 surface', () => {
  it('GET /availability and /input_schema', async () => {
    const a = await app.inject({ method: 'GET', url: '/availability' });
    expect(a.json()).toMatchObject({ status: 'available', type: 'masumi-agent', agentIdentifier: null });
    const s = await app.inject({ method: 'GET', url: '/input_schema' });
    expect(s.json().input_data.map((f: { id: string }) => f.id)).toEqual(['merchant', 'booking_ref', 'passenger_name', 'payout', 'account_holder', 'account_number']);
  });
  it('rejects malformed job bodies (and voucher payouts, which are not "Compensation paid")', async () => {
    expect((await app.inject({ method: 'POST', url: paidUrl, payload: { input_data: TASK } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: paidUrl, payload: { ...BODY, input_data: { ...TASK, payout: 'voucher' } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: paidUrl, payload: { ...BODY, extra: 1 } })).statusCode).toBe(400);
  });
  it('POST /start_job returns MIP-003 fields for an x402 quote', async () => {
    const r = await app.inject({ method: 'POST', url: '/start_job', payload: BODY });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    for (const k of ['blockchainIdentifier', 'payByTime', 'submitResultTime', 'unlockTime', 'externalDisputeUnlockTime', 'agentIdentifier', 'sellerVKey', 'input_hash']) expect(j).toHaveProperty(k);
    expect(j.sellerVKey).toBe(SELLER.paymentKeyHash);
    expect(j.input_hash).toBe(taskInputHash(TASK));
    expect(j.submitResultTime - j.payByTime).toBe(15 * 60_000);
    expect(j.unlockTime - j.payByTime).toBe(35 * 60_000);
    expect(j.externalDisputeUnlockTime - j.payByTime).toBe(55 * 60_000);
  });
  it('GET /status unknown job -> 404; admin routes need chain config; forwarded requests are not local', async () => {
    expect((await app.inject({ method: 'GET', url: '/status?job_id=nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/admin/collect/x' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/admin/collect/x', headers: { 'x-forwarded-for': '1.2.3.4' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/jobs', headers: { 'cf-connecting-ip': '1.2.3.4' } })).statusCode).toBe(403);
  });
});

describe('x402 masumi paid route', () => {
  it('unpaid -> 402 with a seller-signed escrow quote committing to the exact body', async () => {
    const r = await app.inject({ method: 'POST', url: paidUrl, payload: BODY });
    expect(r.statusCode).toBe(402);
    const required = decodePaymentRequiredHeader(String(r.headers['payment-required']));
    const offer = checkMasumiQuote(required, BODY, 5_000_000n);
    expect(offer.payTo).toBe(ESCROW_ADDRESS);
    expect(offer.amount).toBe('5000000');
    const extra = offer.extra as unknown as CardanoExtraMasumi;
    expect(extra.terms.sellerAddress).toBe(SELLER.address);
    expect(extra.terms.agentIdentifier ?? '').toBe('');
    const auth = await verifyMasumiAuthorization(extra, offer, { requireAllPartContent: true, resource: required.resource });
    expect(auth).toMatchObject({ ok: true, escrowAddress: ESCROW_ADDRESS });
  });

  it('paid retry -> verify, job recorded from the commitment (no chain work), settle, 200; retry is idempotent', async () => {
    const first = await app.inject({ method: 'POST', url: paidUrl, payload: BODY });
    const http = new x402HTTPClient(x402Client.fromConfig({
      schemes: [{ network: 'cardano:preprod', client: new ClientScheme(offlineBuyerSigner()) }],
      spendControls: { allowedAssets: [{ network: 'cardano:preprod', asset: 'lovelace', maxAmountPerPayment: '5000000' }] },
    }));
    const required = http.getPaymentRequiredResponse((n) => (first.headers[n.toLowerCase()] as string | undefined) ?? null, first.json());
    const payload = await http.createPaymentPayload(required);
    const headers = { ...http.encodePaymentSignatureHeader(payload), 'content-type': 'application/json' };
    const before = fac.settled;
    const paid = await app.inject({ method: 'POST', url: paidUrl, payload: BODY, headers });
    expect(paid.statusCode).toBe(200);
    expect(fac.settled).toBe(before + 1);
    expect(paid.headers['payment-response']).toBeTruthy();
    const job = paid.json();
    expect(job.status).toBe('awaiting_payment');
    expect(job.input_hash).toBe(taskInputHash(TASK));
    const stored = await store.get(job.job_id);
    expect(stored!.input).toEqual(BODY);
    expect(stored!.expected.referenceSignature).toBe((payload.accepted.extra as unknown as CardanoExtraMasumi).referenceSignature);
    expect(stored!.lockTx).toMatch(/^[0-9a-f]{64}$/);
    // MIP-003 status by job id and by lock tx
    expect((await app.inject({ method: 'GET', url: `/status?job_id=${job.job_id}` })).json().blockchainIdentifier).toBe(job.blockchainIdentifier);
    expect((await app.inject({ method: 'GET', url: `/jobs/by-tx/${stored!.lockTx}` })).json().job_id).toBe(job.job_id);
    // The same signed payment again (a client retry) must not create a second job.
    const again = await app.inject({ method: 'POST', url: paidUrl, payload: BODY, headers });
    if (again.statusCode === 200) expect(again.json().job_id).toBe(job.job_id);
    expect((await store.list()).filter((j) => j.lockTx === stored!.lockTx)).toHaveLength(1);
  });
});
