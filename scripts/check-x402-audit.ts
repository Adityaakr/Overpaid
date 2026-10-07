// x402 statement audit on preprod, both ways a buyer pays:
//  1. a wallet user: the API builds the unsigned payment, the wallet signs, the client sends the x402 header;
//  2. an agent: the standard @x402/cardano client builds and signs its own payment.
import { readFileSync } from 'node:fs';
import { TransactionWitnessSet } from '@evolution-sdk/evolution';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactCardanoScheme } from '@x402/cardano/exact/client';
import { account, NETWORK, requireBlockfrost } from '@overpaid/cardano';
import { API, call, ok } from './check-lib.js';

const bf = requireBlockfrost();
const statement = readFileSync(process.env.STATEMENT ?? 'data/demo/statement.csv', 'utf8');
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });

const preview = await call('/api/audit/preview', { statement });
ok(preview.ok && preview.count > 0, `free preview: ${preview.count} items, $${(preview.totalCents / 100).toFixed(2)}, price ${Number(preview.priceLovelace) / 1e6} tADA`);

const unpaid = await post('/api/x402/audit', { statement });
ok(unpaid.status === 402, `unpaid request -> ${unpaid.status}`);
const required = decodePaymentRequiredHeader(unpaid.headers.get('payment-required') ?? '');
const req0 = required.accepts[0]!;
ok(req0.scheme === 'exact' && req0.network === NETWORK, `402 asks ${Number(req0.amount) / 1e6} tADA to ${req0.payTo.slice(0, 20)}… (${(req0.extra as any)?.assetTransferMethod})`);

async function paid(label: string, header: string) {
  const r = await post('/api/x402/audit', { statement }, { 'PAYMENT-SIGNATURE': header });
  const body = (await r.json()) as any;
  ok(r.status === 200 && body.report?.includes('Recovery audit'), `${label}: ${r.status}, ${body.findings} findings, payment ${body.paymentTx ?? body.error}`);
  console.log(`     https://preprod.cardanoscan.io/transaction/${body.paymentTx}`);
}

// 1. Wallet user (what the browser does with CIP-30).
const user = account(process.env.AUDIT_TEST_WALLET ?? 'room-150');
const built = await call('/api/x402/pay/build', { address: user.address, requirements: req0 });
const uc = user.signingClient(bf);
const witness = await uc.signTx(built.txCbor, { utxos: await uc.getWalletUtxos() });
const { transaction } = await call('/api/x402/pay/assemble', { buildId: built.buildId, witnessSet: TransactionWitnessSet.toCBORHex(witness) });
await paid('wallet user', encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource, accepted: req0, payload: { transaction, nonce: built.nonce } } as any));

// 2. Agent with the standard x402 client and its own key.
if (process.env.SKIP_AGENT !== '1') {
  await new Promise((r) => setTimeout(r, 25_000)); // let the first payment leave the shared mempool view
  const agent = account(process.env.AUDIT_AGENT_WALLET ?? 'overpaid-buyer');
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactCardanoScheme(agent.x402ClientSigner(bf)) }],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: 'lovelace', maxAmountPerPayment: req0.amount }] },
  });
  const again = decodePaymentRequiredHeader((await post('/api/x402/audit', { statement })).headers.get('payment-required') ?? '');
  const payload = await client.createPaymentPayload(again);
  await paid('agent (x402 client)', encodePaymentSignatureHeader(payload));
}
console.log('check-x402-audit passed');
