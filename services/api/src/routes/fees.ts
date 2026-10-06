import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, fees, recoveries, tasks, opportunities, type Db } from '@overpaid/db';
import { MERCHANTS, newId } from '@overpaid/shared';
import type { Bus } from '../bus.js';

// Success fee: a share of money that actually came back, paid by the user from their own wallet.
// Preprod has no dollars, so the fee is shown in tADA at a fixed stand-in rate.
const FEE_BPS = Number(process.env.SUCCESS_FEE_BPS ?? 1500);
const LOVELACE_PER_CENT = Number(process.env.FEE_LOVELACE_PER_CENT ?? 1000);
const MIN_FEE_LOVELACE = 1_000_000;

export function feeLovelace(recoveredCents: number): number {
  return Math.max(MIN_FEE_LOVELACE, Math.round(((recoveredCents * FEE_BPS) / 10_000) * LOVELACE_PER_CENT));
}

// Built transactions wait here for the wallet's signature; the browser never sends a transaction body back.
type Pending = { tx: any; recoveryId: string; payer: string; lovelace: number; at: number };
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 10 * 60_000;

async function feeAddress() {
  const { account } = await import('@overpaid/cardano');
  return process.env.FEE_ADDRESS || account('treasury').address;
}

export async function registerFeeRoutes(app: FastifyInstance, { db, bus }: { db: Db; bus: Bus }) {
  app.post<{ Params: { id: string } }>('/api/fees/:id/build', async (req, reply) => {
    const { address } = z.object({ address: z.string().startsWith('addr_test1'), utxos: z.array(z.string()).optional() }).parse(req.body);
    const [rec] = await db.select().from(recoveries).where(eq(recoveries.id, req.params.id));
    if (!rec) return reply.code(404).send({ error: 'no confirmed recovery with that id' });
    const [paid] = await db.select().from(fees).where(eq(fees.recoveryId, rec.id));
    if (paid?.state === 'paid' || paid?.state === 'submitted') return reply.code(409).send({ error: 'fee already paid', txHash: paid.txHash });

    const { Address, Assets, Client, preprod, Transaction } = await import('@evolution-sdk/evolution');
    const { requireBlockfrost, toMetadatum } = await import('@overpaid/cardano');
    const bf = requireBlockfrost();
    const lovelace = feeLovelace(rec.amount);
    const payTo = await feeAddress();
    try {
      const builder = await Client.make(preprod)
        .withBlockfrost(bf)
        .withAddress(address)
        .newTx()
        .payToAddress({ address: Address.fromBech32(payTo), assets: Assets.fromLovelace(BigInt(lovelace)) })
        .attachMetadata({ label: 674n, metadata: toMetadatum({ msg: ['Overpaid success fee', rec.id] }) })
        .build();
      const tx = await builder.toTransaction();
      const txCbor = Transaction.toCBORHex(tx);
      const id = newId('feetx');
      for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
      pending.set(id, { tx, recoveryId: rec.id, payer: address, lovelace, at: Date.now() });
      return { buildId: id, txCbor, feeLovelace: lovelace, payTo };
    } catch (e) {
      return reply.code(400).send({ error: `could not build the fee transaction: ${(e as Error).message}` });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fees/:id/submit', async (req, reply) => {
    const body = z.object({ buildId: z.string().optional(), txCbor: z.string(), witnessSet: z.string() }).parse(req.body);
    const entry = body.buildId
      ? pending.get(body.buildId)
      : [...pending.values()].find((p) => p.recoveryId === req.params.id);
    if (!entry || entry.recoveryId !== req.params.id) return reply.code(410).send({ error: 'build expired; build the fee transaction again' });
    const { Transaction, TransactionWitnessSet } = await import('@evolution-sdk/evolution');
    const { requireBlockfrost } = await import('@overpaid/cardano');
    try {
      // Our own body, the wallet's signatures: the browser cannot change what is being paid.
      const signed = new Transaction.Transaction({
        body: entry.tx.body,
        witnessSet: TransactionWitnessSet.fromCBORHex(body.witnessSet),
        isValid: entry.tx.isValid,
        auxiliaryData: entry.tx.auxiliaryData,
      });
      const bf = requireBlockfrost();
      const res = await fetch(`${bf.baseUrl}/tx/submit`, {
        method: 'POST',
        headers: { project_id: bf.projectId, 'content-type': 'application/cbor' },
        body: Buffer.from(Transaction.toCBORHex(signed), 'hex'),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.slice(0, 300));
      const txHash = JSON.parse(text) as string;
      const payTo = await feeAddress();
      await db
        .insert(fees)
        .values({ id: newId('fee'), recoveryId: entry.recoveryId, lovelace: entry.lovelace, payerAddress: entry.payer, payTo, txHash, state: 'submitted' })
        .onConflictDoUpdate({ target: fees.recoveryId, set: { txHash, state: 'submitted', payerAddress: entry.payer } });
      for (const [k, v] of pending) if (v.recoveryId === entry.recoveryId) pending.delete(k);
      await bus.emit('money.recovered', { feeTx: txHash, recoveryId: entry.recoveryId });
      void confirmFee(db, entry.recoveryId, txHash);
      return { txHash, txUrl: `https://preprod.cardanoscan.io/transaction/${txHash}` };
    } catch (e) {
      return reply.code(400).send({ error: `wallet signature rejected or submit failed: ${(e as Error).message}` });
    }
  });

  app.get<{ Querystring: { address?: string } }>('/api/me/balance', async (req, reply) => {
    const address = req.query.address;
    if (!address?.startsWith('addr_test1')) return reply.code(400).send({ error: 'address required' });
    const { addressBalance, blockfrost } = await import('@overpaid/cardano');
    const b = await addressBalance(blockfrost(), address).catch(() => null);
    return { lovelace: Number(b?.lovelace ?? 0) };
  });

  // Everything this wallet did on chain through Overpaid.
  app.get<{ Querystring: { address?: string } }>('/api/me/chain', async (req, reply) => {
    const address = req.query.address;
    if (!address?.startsWith('addr_test1')) return reply.code(400).send({ error: 'address required' });
    const feeRows = await db
      .select({ f: fees, r: recoveries, o: opportunities })
      .from(fees)
      .innerJoin(recoveries, eq(fees.recoveryId, recoveries.id))
      .innerJoin(tasks, eq(recoveries.taskId, tasks.id))
      .innerJoin(opportunities, eq(tasks.opportunityId, opportunities.id))
      .where(eq(fees.payerAddress, address));
    const pledges = await fetch(`http://127.0.0.1:4300/pledges?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    return {
      pledges,
      fees: feeRows.map(({ f, o }) => ({ receiptId: f.recoveryId, merchant: o.merchant, lovelace: f.lovelace, txHash: f.txHash, state: f.state, at: f.paidAt ?? f.createdAt })),
      hires: [],
    };
  });
}

async function confirmFee(db: Db, recoveryId: string, txHash: string) {
  try {
    const { awaitTx, blockfrost } = await import('@overpaid/cardano');
    if (await awaitTx(blockfrost(), txHash)) await db.update(fees).set({ state: 'paid', paidAt: new Date() }).where(eq(fees.recoveryId, recoveryId));
  } catch {
    // stays 'submitted'; the receipts view still links the transaction
  }
}

export function feeView(row: typeof fees.$inferSelect | undefined, amountCents: number, merchant: string) {
  const demo = Object.values(MERCHANTS).some((m) => m.name === merchant);
  return {
    state: row?.state === 'paid' ? 'paid' : row?.state === 'submitted' ? 'submitted' : 'unpaid',
    lovelace: row?.lovelace ?? feeLovelace(amountCents),
    txHash: row?.txHash ?? null,
    label: `${FEE_BPS / 100}% success fee${demo ? ', test fee on a demo recovery' : ''}`,
  };
}
