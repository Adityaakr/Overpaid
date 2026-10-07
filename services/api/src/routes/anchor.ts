import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, evidence, opportunities, type Db } from '@overpaid/db';
import { newId } from '@overpaid/shared';
import type { Bus } from '../bus.js';

// Review anchor: the user signs one small transaction that carries the hash of this week's review
// (every line, its value, and the evidence bundle hash of each agent run). It proves what Clawback
// found and when, from the user's own wallet, with no custody and no fee to us.
type Pending = { tx: any; payer: string; hash: string; summary: Summary; at: number };
type Summary = { lines: number; atStakeCents: number; researched: number; ranAt: string | null };
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 10 * 60_000;
export const ANCHOR_LABEL = 1990n;

export type Anchor = { txHash: string; hash: string; at: string; payer: string; summary: Summary };

export async function reviewDigest(db: Db, bus: Bus) {
  const opps = await db.select().from(opportunities).orderBy(desc(opportunities.valueEstimate));
  const evs = await db.select().from(evidence);
  const evBy = new Map(evs.map((e) => [e.taskId, e.sha256]));
  const run = (await bus.allMetrics()).find_run as { ranAt?: string } | undefined;
  const open = opps.filter((o) => o.status !== 'dismissed');
  const lines = open.map((o) => {
    const r = o.meta.research as { taskId?: string } | undefined;
    return { id: o.id, merchant: o.merchant, kind: o.vigilType, cents: o.valueEstimate, status: o.status, evidence: r?.taskId ? evBy.get(r.taskId) ?? null : null };
  });
  const doc = { app: 'clawback', network: 'preprod', ranAt: run?.ranAt ?? null, lines };
  const hash = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  const summary: Summary = { lines: lines.length, atStakeCents: lines.reduce((s, l) => s + l.cents, 0), researched: lines.filter((l) => l.evidence).length, ranAt: run?.ranAt ?? null };
  return { hash, summary, doc };
}

export async function registerAnchorRoutes(app: FastifyInstance, { db, bus }: { db: Db; bus: Bus }) {
  app.post('/api/anchor/build', async (req, reply) => {
    const { address } = z.object({ address: z.string().startsWith('addr_test1'), utxos: z.array(z.string()).optional() }).parse(req.body);
    const { hash, summary } = await reviewDigest(db, bus);
    const { Address, Assets, Client, preprod, Transaction } = await import('@evolution-sdk/evolution');
    const { requireBlockfrost, toMetadatum } = await import('@overpaid/cardano');
    try {
      const at = new Date().toISOString();
      const builder = await Client.make(preprod)
        .withBlockfrost(requireBlockfrost())
        .withAddress(address)
        .newTx()
        // Pays the minimum back to the signer: the point of the transaction is its metadata.
        .payToAddress({ address: Address.fromBech32(address), assets: Assets.fromLovelace(1_500_000n) })
        .attachMetadata({ label: 674n, metadata: toMetadatum({ msg: ['Clawback review anchor', at.slice(0, 10)] }) })
        .attachMetadata({ label: ANCHOR_LABEL, metadata: toMetadatum({ v: 1, sha256: hash, lines: summary.lines, cents: summary.atStakeCents, researched: summary.researched, at }) })
        .build();
      const tx = await builder.toTransaction();
      const id = newId('anchortx');
      for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
      pending.set(id, { tx, payer: address, hash, summary, at: Date.now() });
      return { buildId: id, txCbor: Transaction.toCBORHex(tx), hash, summary };
    } catch (e) {
      return reply.code(400).send({ error: `could not build the anchor transaction: ${(e as Error).message}` });
    }
  });

  app.post('/api/anchor/submit', async (req, reply) => {
    const body = z.object({ buildId: z.string(), txCbor: z.string(), witnessSet: z.string() }).parse(req.body);
    const entry = pending.get(body.buildId);
    if (!entry) return reply.code(410).send({ error: 'build expired; build the anchor again' });
    const { Transaction, TransactionWitnessSet } = await import('@evolution-sdk/evolution');
    const { requireBlockfrost } = await import('@overpaid/cardano');
    try {
      // Our body, the wallet's signatures: the browser cannot change what is being anchored.
      const signed = new Transaction.Transaction({ body: entry.tx.body, witnessSet: TransactionWitnessSet.fromCBORHex(body.witnessSet), isValid: entry.tx.isValid, auxiliaryData: entry.tx.auxiliaryData });
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
      const anchor: Anchor = { txHash, hash: entry.hash, at: new Date().toISOString(), payer: entry.payer, summary: entry.summary };
      pending.delete(body.buildId);
      await bus.setMetric('review_anchor', anchor);
      await bus.emit('metrics.updated', { review_anchor: anchor });
      return { ...anchor, txUrl: `https://preprod.cardanoscan.io/transaction/${txHash}` };
    } catch (e) {
      return reply.code(400).send({ error: `wallet signature rejected or submit failed: ${(e as Error).message}` });
    }
  });
}
