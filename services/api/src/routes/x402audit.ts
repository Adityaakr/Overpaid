import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { newId } from '@overpaid/shared';

// The statement audit sold per request over x402 (exact scheme, default method): no account, no API key.
// Agents pay with any x402 Cardano client; people pay from their CIP-30 wallet through the build/assemble helpers,
// which only prepare an unsigned transaction and merge the wallet's signature. Overpaid never holds the payer's key.
export const AUDIT_PATH = '/api/x402/audit';
const PRICE_LOVELACE = BigInt(process.env.AUDIT_PRICE_LOVELACE ?? 2_000_000);
const MAX_TIMEOUT_S = 300;

const Body = z.object({ statement: z.string().min(20).max(200_000) });

async function payTo() {
  const { account } = await import('@overpaid/cardano');
  return process.env.AUDIT_PAY_TO || process.env.FEE_ADDRESS || account('treasury').address;
}

let offer: Promise<{ http: any; resource: string }> | undefined;
function getOffer(publicBase: string) {
  offer ??= (async () => {
    const { x402HTTPResourceServer, x402ResourceServer } = await import('@x402/core/server');
    const { ExactCardanoScheme } = await import('@x402/cardano/exact/server');
    const { NETWORK, inProcessFacilitator, requireBlockfrost } = await import('@overpaid/cardano');
    const server = new x402ResourceServer(inProcessFacilitator(requireBlockfrost())).register(NETWORK, new ExactCardanoScheme());
    const resource = `${publicBase}${AUDIT_PATH}`;
    const http = new x402HTTPResourceServer(server, {
      [`POST ${AUDIT_PATH}`]: {
        resource,
        accepts: {
          scheme: 'exact',
          network: NETWORK,
          payTo: await payTo(),
          maxTimeoutSeconds: MAX_TIMEOUT_S,
          price: { amount: PRICE_LOVELACE.toString(), asset: 'lovelace' },
          extra: { assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations: 0 } },
        },
        description: 'Overpaid recovery audit: a card statement in, a sourced recovery list and merchant messages out. Priced in tADA on preprod.',
        mimeType: 'application/json',
      },
    });
    await server.initialize();
    await http.initialize();
    return { http, resource };
  })();
  return offer;
}

// Unsigned payment transactions waiting for the wallet's signature; the browser never sends a body back.
const pending = new Map<string, { tx: any; at: number }>();
// Paid results by a private claim id the buyer sends with the paid request, so a dropped response can be fetched
// again without paying twice. Only the sha256 of the claim is kept as the key.
const CLAIM_TTL_MS = 24 * 60 * 60_000;
const claims = new Map<string, { body: unknown; at: number }>();
const claimKey = (id: string) => createHash('sha256').update(id).digest('hex');

export async function registerX402AuditRoutes(app: FastifyInstance) {
  const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  // Free preview: how much there is to recover, without the source rows or the messages.
  app.post('/api/audit/preview', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Paste a statement as CSV with Date, Description and Amount columns.' });
    const { audit, kindLabel } = await import('@overpaid/coworker/audit');
    const a = await audit(parsed.data.statement);
    // Free: the summary and what each item is worth. Paid: source rows, reasons, actions and messages.
    return {
      ok: a.ok, warnings: a.warnings, currency: a.currency, rows: a.rows, months: a.months, from: a.from, to: a.to,
      moneyInCents: a.moneyInCents, moneyOutCents: a.moneyOutCents, avgMonthlyOutCents: a.avgMonthlyOutCents, recurringMonthlyCents: a.recurringMonthlyCents,
      claimCents: a.claimCents, reviewYearCents: a.reviewYearCents,
      items: a.items.map((i) => ({ kind: i.kind, label: kindLabel(i.kind), title: i.title, category: i.category, cents: i.cents, per: i.per, confidence: i.confidence })),
      fixed: a.fixed,
      count: a.items.length, totalCents: a.totalCents,
      priceLovelace: PRICE_LOVELACE.toString(),
    };
  });

  // The paid resource. Unpaid: 402 with PAYMENT-REQUIRED. Paid: verify, run the audit, settle, then respond.
  app.post(AUDIT_PATH, async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Paste a statement as CSV with Date, Description and Amount columns.' });
    const { runPaidRoute } = await import('@overpaid/cardano');
    const { buildReport } = await import('@overpaid/coworker/report');
    const { http } = await getOffer(base);
    let lastBody: unknown;
    const out = await runPaidRoute(
      http,
      { method: 'POST', path: AUDIT_PATH, url: `${base}${AUDIT_PATH}`, headers: req.headers as Record<string, string>, body: parsed.data },
      async (ctx) => {
        const r = await buildReport(parsed.data.statement);
        const { kindLabel } = await import('@overpaid/coworker/audit');
        lastBody = {
          report: r.text, actions: r.actions, model: r.model, paymentTx: ctx.txHash, findings: r.audit.items.length, totalCents: r.audit.totalCents,
          audit: { ...r.audit, findings: undefined, items: r.audit.items.map((i) => ({ ...i, label: kindLabel(i.kind) })) },
        };
        return { body: lastBody };
      },
      (_ctx, _settle) => {
        // Settled: keep the result for the buyer's claim id in case the response never reaches them.
        const claim = String(req.headers['x-audit-claim'] ?? '');
        if (/^[A-Za-z0-9_-]{16,64}$/.test(claim)) {
          for (const [k, v] of claims) if (Date.now() - v.at > CLAIM_TTL_MS) claims.delete(k);
          claims.set(claimKey(claim), { body: lastBody, at: Date.now() });
        }
      },
    );
    for (const [k, v] of Object.entries(out.headers)) reply.header(k, v);
    reply.header('access-control-expose-headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
    return reply.code(out.status).send(out.body);
  });

  // A paid result whose response was lost on the way back.
  app.get<{ Params: { claim: string } }>('/api/x402/audit/claim/:claim', async (req, reply) => {
    const hit = claims.get(claimKey(req.params.claim));
    return hit ? hit.body : reply.code(404).send({ error: 'no paid result for that claim yet' });
  });

  // Wallet helper, step 1: an unsigned payment for the 402's requirements, spending one of the payer's UTxOs as nonce.
  app.post('/api/x402/pay/build', async (req, reply) => {
    const b = z
      .object({ address: z.string().startsWith('addr_test1'), requirements: z.object({ payTo: z.string(), amount: z.string(), asset: z.literal('lovelace'), maxTimeoutSeconds: z.number() }) })
      .parse(req.body);
    const expected = await payTo();
    if (b.requirements.payTo !== expected || BigInt(b.requirements.amount) !== PRICE_LOVELACE) return reply.code(400).send({ error: 'requirements do not match this offer' });
    const { Address, Assets, Client, preprod, Transaction } = await import('@evolution-sdk/evolution');
    const { requireBlockfrost, spendableWalletUtxos } = await import('@overpaid/cardano');
    try {
      const client = Client.make(preprod).withBlockfrost(requireBlockfrost()).withAddress(b.address);
      const utxos = spendableWalletUtxos(await client.getWalletUtxos());
      const nonceUtxo = utxos.find((u) => Assets.lovelaceOf(u.assets) >= PRICE_LOVELACE + 2_000_000n) ?? utxos[0];
      if (!nonceUtxo) return reply.code(400).send({ error: 'This wallet has no tADA on preprod yet. Fund it from the faucet first.' });
      const nonce = `${Buffer.from(nonceUtxo.transactionId.hash).toString('hex')}#${Number(nonceUtxo.index)}`;
      const built = await client
        .newTx()
        .collectFrom({ inputs: [nonceUtxo] })
        .payToAddress({ address: Address.fromBech32(b.requirements.payTo), assets: Assets.fromLovelace(BigInt(b.requirements.amount)) })
        .setValidity({ to: BigInt(Date.now() + b.requirements.maxTimeoutSeconds * 1000) })
        .build({ availableUtxos: utxos });
      const tx = await built.toTransaction();
      const id = newId('x402tx');
      for (const [k, v] of pending) if (Date.now() - v.at > MAX_TIMEOUT_S * 1000) pending.delete(k);
      pending.set(id, { tx, at: Date.now() });
      return { buildId: id, txCbor: Transaction.toCBORHex(tx), nonce };
    } catch (e) {
      return reply.code(400).send({ error: `could not build the payment: ${(e as Error).message}` });
    }
  });

  // Wallet helper, step 2: our body plus the wallet's witnesses, as the base64 transaction the x402 payload carries.
  app.post('/api/x402/pay/assemble', async (req, reply) => {
    const b = z.object({ buildId: z.string(), witnessSet: z.string() }).parse(req.body);
    const entry = pending.get(b.buildId);
    if (!entry) return reply.code(410).send({ error: 'payment expired; start again' });
    pending.delete(b.buildId);
    const { Transaction, TransactionWitnessSet } = await import('@evolution-sdk/evolution');
    const signed = new Transaction.Transaction({ body: entry.tx.body, witnessSet: TransactionWitnessSet.fromCBORHex(b.witnessSet), isValid: entry.tx.isValid, auxiliaryData: entry.tx.auxiliaryData });
    return { transaction: Buffer.from(Transaction.toCBORHex(signed), 'hex').toString('base64') };
  });
}
