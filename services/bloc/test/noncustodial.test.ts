import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Address, AddressEras, Assets, KeyHash, TransactionInput, TransactionOutput, Value, PrivateKey, Transaction, TransactionBody, TransactionHash, TransactionWitnessSet, UTxO, preprod,
} from '@evolution-sdk/evolution';
import { makeTxBuilder } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import { blocAddress, type PledgeDatum } from '@overpaid/bloc-contract';
import { blocOf, buildApp } from '../src/app.js';
import type { ChainOps } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { pledgeDatumFor } from '../src/offer.js';
import { PREPROD_PARAMS } from '../src/offline.js';
import { BlocStore, type CampaignRecord } from '../src/store.js';
import { JoinTokens } from '../src/tokens.js';
import { applyPledges, pickReferenceScript } from '../src/txs.js';
import { mergeWitnesses, utxoFromCip30Hex, validatePledgeTx } from '../src/usertx.js';
import { BLOC, BLOC_ADDRESS, BLOC_ID, CAMPAIGN, ITEM_HASH, NOW, POLICY, SEED, VK, bech, keyAddr, txHash } from './fixtures.js';

const record: CampaignRecord = {
  id: 'esim-eu-30d', item: 'eSIM Europe 30-day 10GB', itemHash: ITEM_HASH, asset: { policy: '', name: '', label: 'tADA' }, unitLabel: 'u',
  membersLimit: 150, minBatch: 1, bidDeadline: Number(CAMPAIGN.bidDeadline), refundDeadline: Number(CAMPAIGN.refundDeadline),
  providerVkeys: VK.slice(0, 3), policyId: POLICY.hash, blocHash: BLOC.hash, blocIdHex: BLOC_ID, seed: SEED, campaignTx: 'aa'.repeat(32),
  scriptAddress: BLOC_ADDRESS, state: 'open', marketPrice: '2400000', createdAt: 0,
};

// The "browser wallet": a plain ed25519 key and its enterprise key address.
const SK = PrivateKey.fromBytes(new Uint8Array(32).fill(7));
const USER_KH = KeyHash.toHex(KeyHash.fromVKey(PrivateKey.toPublicKey(SK)));
const USER = bech({ payment: { type: 'key', hash: USER_KH } });
const OTHER = bech(keyAddr(4242));

const userUtxo = (n: number, lovelace = 20_000_000n) =>
  new UTxO.UTxO({ transactionId: TransactionHash.fromHex(txHash(70_000 + n)), index: 0n, address: Address.fromBech32(USER), assets: Assets.fromLovelace(lovelace) });

async function buildPledge(o: { to?: string; datum?: PledgeDatum; lovelace?: bigint; twice?: boolean } = {}): Promise<string> {
  const datum = o.datum ?? pledgeDatumFor(record, USER);
  const outs = [{ datum, lovelace: o.lovelace ?? 4_500_000n }];
  if (o.twice) outs.push(outs[0]!);
  const built = await applyPledges(makeTxBuilder({ chain: preprod }), o.to ?? BLOC_ADDRESS, record.asset, outs)
    .build({ changeAddress: Address.fromBech32(USER), availableUtxos: [userUtxo(1)], fullProtocolParameters: PREPROD_PARAMS });
  return Transaction.toCBORHex(await built.toTransaction());
}

/** What CIP-30 signTx(cbor, true) returns: a witness set with the user's vkey witness. */
function walletSign(txCbor: string, sk = SK): string {
  const bodyHash = TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Buffer.from(txCbor, 'hex'))).hash;
  const w = new TransactionWitnessSet.VKeyWitness({ vkey: PrivateKey.toPublicKey(sk), signature: PrivateKey.sign(sk, bodyHash) });
  return TransactionWitnessSet.toCBORHex(TransactionWitnessSet.fromVKeyWitnesses([w]));
}

const signedPledge = async (o?: Parameters<typeof buildPledge>[0]) => {
  const cbor = await buildPledge(o);
  return { cbor, ws: walletSign(cbor), signed: mergeWitnesses(cbor, walletSign(cbor)) };
};

describe('pledge/submit validation', () => {
  it('accepts a well-formed user-signed pledge and keeps the tx id stable through the merge', async () => {
    const { cbor, signed } = await signedPledge();
    const r = validatePledgeTx(signed, record);
    expect(r.refundAddress).toBe(USER);
    expect(r.lockedLovelace).toBe(4_500_000n);
    expect(Transaction.extractBodyBytes(Buffer.from(signed, 'hex'))).toEqual(Transaction.extractBodyBytes(Buffer.from(cbor, 'hex')));
  });
  it('rejects a pledge paid to the wrong address', async () => {
    const { signed } = await signedPledge({ to: blocAddress('ab'.repeat(28), 0) });
    expect(() => validatePledgeTx(signed, record)).toThrow(/exactly one output at the bloc address/);
  });
  it('rejects two outputs at the bloc address', async () => {
    const { signed } = await signedPledge({ twice: true });
    expect(() => validatePledgeTx(signed, record)).toThrow(/found 2/);
  });
  it('rejects a wrong datum (other bloc id, other price)', async () => {
    const other = await signedPledge({ datum: { ...pledgeDatumFor(record, USER), blocId: 'ff' } });
    expect(() => validatePledgeTx(other.signed, record)).toThrow(/another bloc/);
    const cheap = await signedPledge({ datum: pledgeDatumFor(record, USER, 1n, 1n) });
    expect(() => validatePledgeTx(cheap.signed, record)).toThrow(/max_unit_price/);
  });
  it('rejects too little value', async () => {
    const { signed } = await signedPledge({ lovelace: 4_000_000n });
    expect(() => validatePledgeTx(signed, record)).toThrow(/needs at least/);
  });
  it('rejects a foreign refund address (not signed by its key) and an unsigned tx', async () => {
    const { signed } = await signedPledge({ datum: pledgeDatumFor(record, OTHER) });
    expect(() => validatePledgeTx(signed, record)).toThrow(/did not sign/);
    expect(() => validatePledgeTx(signed, record)).toThrow();
    const cbor = await buildPledge();
    expect(() => validatePledgeTx(cbor, record)).toThrow(/did not sign/);
    // a witness from another key over the right body does not count either
    const wrongKey = mergeWitnesses(cbor, walletSign(cbor, PrivateKey.fromBytes(new Uint8Array(32).fill(9))));
    expect(() => validatePledgeTx(wrongKey, record)).toThrow(/did not sign/);
  });
});

// ------------------------------------------------------------------------------------------------ HTTP

const fakeChain = (over: Partial<ChainOps> = {}): ChainOps => ({
  tipMs: async () => NOW,
  createCampaign: async () => record,
  pledgeFromWallet: async () => ({ txHash: 'bb'.repeat(32), outputIndex: 0, address: 'x' }),
  simulateBatch: async () => ({ txHash: 'cc'.repeat(32), outputs: [] }),
  readBloc: async () => { throw new Error('n/a'); },
  settle: async () => 'dd'.repeat(32),
  refund: async () => 'ee'.repeat(32),
  awaitTx: async () => true,
  buildUserPledge: async () => ({ txCbor: await buildPledge() }),
  buildUserRefund: async () => ({ txCbor: '00' }),
  submitSigned: async (cbor) => TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(Buffer.from(cbor, 'hex')))),
  ...over,
});

async function setup(chain: ChainOps, campaign: CampaignRecord | null = record) {
  const cfg = { ...loadConfig({}), stateFile: null, tokensFile: null, autoRefundMs: 0 };
  const store = new BlocStore(null);
  if (campaign) store.setCampaign({ ...campaign });
  const app = await buildApp({ cfg, store, chain, chainReason: null, log: () => {} });
  return { app, store };
}

describe('non-custodial HTTP', () => {
  it('build -> sign -> submit records a cip30 pledge with the user refund address; /pledges lists it', async () => {
    const { app } = await setup(fakeChain());
    expect((await app.inject({ method: 'POST', url: '/pledge/build', payload: { address: USER, utxos: ['zz'] } })).statusCode).toBe(400);
    const b0 = await app.inject({ method: 'POST', url: '/pledge/build', payload: { address: USER, utxos: [cip30Hex()] } });
    expect(b0.statusCode).toBe(200);
    expect(b0.json()).toMatchObject({ lockedLovelace: 4_500_000, refundAddress: USER });
    const cbor = b0.json().txCbor as string;
    const ws = walletSign(cbor);
    const r = await app.inject({ method: 'POST', url: '/pledge/submit', payload: { txCbor: cbor, witnessSet: ws, nickname: 'Ada <b>' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ label: 'Ada b' });
    expect((await app.inject({ method: 'POST', url: '/pledge/submit', payload: { txCbor: cbor, witnessSet: ws } })).statusCode).toBe(409);
    const s = (await app.inject({ method: 'GET', url: '/state' })).json();
    expect(s.pledges.recent[0]).toMatchObject({ via: 'cip30', simulated: false });
    const mine = (await app.inject({ method: 'GET', url: `/pledges?address=${USER}` })).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ via: 'cip30', state: 'submitted', lockedLovelace: 4_500_000, settlementTxHash: null, refundTxHash: null, campaignId: record.id });
    await app.close();
  });

  it('pledge/submit rejects a foreign refund address with 422', async () => {
    const { app } = await setup(fakeChain());
    const cbor = await buildPledge({ datum: pledgeDatumFor(record, OTHER) });
    const r = await app.inject({ method: 'POST', url: '/pledge/submit', payload: { txCbor: cbor, witnessSet: walletSign(cbor) } });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it('pledge endpoints refuse after the bid deadline', async () => {
    const { app } = await setup(fakeChain({ tipMs: async () => CAMPAIGN.bidDeadline + 1n }));
    const { cbor, ws } = await signedPledge();
    expect((await app.inject({ method: 'POST', url: '/pledge/submit', payload: { txCbor: cbor, witnessSet: ws } })).statusCode).toBe(409);
    await app.close();
  });

  it('refund/build is refused before the refund deadline', async () => {
    const { app } = await setup(fakeChain());
    const r = await app.inject({ method: 'POST', url: '/refund/build', payload: { ref: `${'ab'.repeat(32)}#0`, address: USER, utxos: [cip30Hex()] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/refund deadline/);
    await app.close();
  });

  it('settle and refund set busy synchronously: a concurrent second call gets 409', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const chain = fakeChain({ tipMs: async () => { await gate; return CAMPAIGN.refundDeadline + 10_000n; } });
    const { app } = await setup(chain);
    const a = app.inject({ method: 'POST', url: '/admin/settle', payload: {} });
    const b = app.inject({ method: 'POST', url: '/admin/refund', payload: {} });
    const c2 = app.inject({ method: 'POST', url: '/admin/settle', payload: {} });
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c2]);
    expect(rb.statusCode).toBe(409);
    expect(rb.json().error).toMatch(/busy: settle/);
    expect(rc.statusCode).toBe(409);
    expect(ra.statusCode).toBe(502); // readBloc fails in the fake; busy must be released
    expect(blocOf(app).job.busy).toBeNull();
    await app.close();
  });

  it('auto-refund failure resets the campaign state (never stuck in refunding)', async () => {
    const chain = fakeChain({
      tipMs: async () => CAMPAIGN.refundDeadline + 10_000n,
      readBloc: async () => ({ campaignUtxo: userUtxo(9), valid: [], invalid: [], refundable: [{ utxo: userUtxo(2), pledge: { ref: { txHash: 'ab'.repeat(32), index: 0 }, lovelace: 1n, locked: 1n, datum: pledgeDatumFor(record, USER) } }] }),
      refund: async () => { throw new Error('boom'); },
    });
    const { app, store } = await setup(chain);
    expect(await blocOf(app).autoRefundTick()).toBeNull();
    expect(store.data.campaign!.state).toBe('open');
    expect(blocOf(app).job.busy).toBeNull();
    await app.close();
  });
});

/** A CIP-30 getUtxos item: CBOR array(2) [transaction_input, transaction_output]. */
function cip30Hex(n = 1, lovelace = 20_000_000n): string {
  const input = new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(txHash(80_000 + n)), index: 0n });
  const output = new TransactionOutput.ShelleyTransactionOutput({ address: AddressEras.fromBech32(USER), amount: new Value.OnlyCoin({ coin: lovelace }) });
  return `82${TransactionInput.toCBORHex(input)}${TransactionOutput.toCBORHex(output)}`;
}

describe('reference script and tokens', () => {
  it('parses CIP-30 getUtxos CBOR', () => {
    const u = utxoFromCip30Hex(cip30Hex(3, 7_000_000n));
    expect(Address.toBech32(u.address)).toBe(USER);
    expect(Assets.lovelaceOf(u.assets)).toBe(7_000_000n);
  });

  it('readBloc only accepts a reference script whose hash is the bloc script hash', () => {
    const mk = (n: number, script: unknown) => new UTxO.UTxO({
      transactionId: TransactionHash.fromHex(txHash(90_000 + n)), index: 0n, address: Address.fromBech32(BLOC_ADDRESS), assets: Assets.fromLovelace(20_000_000n),
      scriptRef: script as UTxO.UTxO['scriptRef'],
    });
    const stray = mk(1, POLICY.script);
    const real = mk(2, BLOC.script);
    expect(pickReferenceScript([stray], BLOC.hash)).toBeUndefined();
    expect(pickReferenceScript([stray, real], BLOC.hash)).toBe(real);
  });

  it('join tokens persist across restarts and nextSlot skips used room wallets', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'bloc-tok-')), 'join-tokens.json');
    const a = new JoinTokens({ file });
    const [t1, t2] = a.issue(2);
    expect(a.consume(t1, '1.1.1.1')).toMatchObject({ ok: true, wallet: 'room-001' });
    const b = new JoinTokens({ file });
    expect(b.consume(t1, '2.2.2.2')).toMatchObject({ ok: false, status: 409 });
    expect(b.consume(t2, '2.2.2.2')).toMatchObject({ ok: true, wallet: 'room-002' });
    const c = new JoinTokens({ file, usedWallets: ['room-007', null, 'sim-3'] });
    expect(c.next).toBe(8);
    expect(new JoinTokens({ usedWallets: ['room-150'] }).remaining).toBe(0);
  });
});
