/**
 * Online chain operations (Cardano preprod via Blockfrost + Evolution). Every entry point requires
 * BLOCKFROST_PROJECT_ID and the relevant seed; without them `makeChain()` returns null and the HTTP layer answers 503
 * with the reason. Pattern follows packages/cardano/src/escrow/actions.ts: build (Blockfrost evaluates scripts during
 * build), sign, submit; transactions from one wallet are serialised.
 */
import { Address, Assets, Client, Transaction, TransactionHash, preprod, type UTxO } from '@evolution-sdk/evolution';
import {
  blocAddress, blocScript, campaignPolicy, plutusAddressFromBech32, type Bid, type CampaignDatum, type Hex, type PledgeDatum,
} from '@overpaid/bloc-contract';
import {
  account, awaitTx, blockfrost, blockfrostConfig, PrerequisiteError, seedMnemonic, serial, type Blockfrost, type BlockfrostConfig,
} from '@overpaid/cardano';
import { pledgeDatumFor } from './offer.js';
import { validatePledge, type CampaignInfo, type SettlementBatch, type ValidPledge } from './planner.js';
import type { CampaignRecord } from './store.js';
import { applyCreateCampaign, applyPledges, applyRefund, applySettle, chainPledgeOf, pickReferenceScript, refundablePledgeOf, utxoRef } from './txs.js';
import { submitCbor } from './usertx.js';
import { ASSET_ADA, ASSET_LABEL, MARKET_PRICE_LOVELACE, PLEDGE_LOCK_LOVELACE, UNIT_LABEL } from './units.js';

export interface NewCampaign {
  id: string;
  item: string;
  membersLimit: number;
  minBatch: number;
  bidDeadline: number;
  refundDeadline: number;
  providerVkeys: string[];
  publishReferenceScript: boolean;
}

export interface BlocUtxos {
  campaignUtxo: UTxO.UTxO;
  referenceScriptUtxo?: UTxO.UTxO;
  valid: Array<{ utxo: UTxO.UTxO; pledge: ValidPledge }>;
  invalid: Array<{ utxo: UTxO.UTxO; reason: string }>;
  /** Every UTxO whose datum parses as a PledgeDatum (any bloc id / price): what the permissionless Refund path can return. */
  refundable: Array<{ utxo: UTxO.UTxO; pledge: ValidPledge }>;
}

export interface UnsignedTx {
  txCbor: string;
}

export interface ChainOps {
  tipMs(): Promise<bigint>;
  createCampaign(c: NewCampaign): Promise<CampaignRecord>;
  /** Room pledge from a seed-C demo wallet (direct submit, same offer format as the x402 script method). */
  pledgeFromWallet(walletName: string, c: CampaignRecord): Promise<{ txHash: string; outputIndex: number; address: string }>;
  /** ~60 simulated pledges in one treasury tx, each refunding to sim-<n>. */
  simulateBatch(c: CampaignRecord, firstSim: number, count: number): Promise<{ txHash: string; outputs: Array<{ outputIndex: number; sim: string; refundAddress: string }> }>;
  readBloc(c: CampaignRecord, info: CampaignInfo): Promise<BlocUtxos>;
  settle(c: CampaignRecord, u: BlocUtxos, batch: SettlementBatch, bid: Bid, signature: Hex): Promise<string>;
  /** Refund the given pledges (from BlocUtxos.refundable), bloc-admin pays the fee. */
  refund(c: CampaignRecord, u: BlocUtxos, pledges: Array<{ utxo: UTxO.UTxO; pledge: ValidPledge }>): Promise<string>;
  /** Unsigned pledge tx paid from the user's own UTxOs (CIP-30), change back to `address`. */
  buildUserPledge(c: CampaignRecord, address: string, utxos: UTxO.UTxO[], datum: PledgeDatum): Promise<UnsignedTx>;
  /** Unsigned refund tx for one pledge, fee and collateral from the user's UTxOs. */
  buildUserRefund(c: CampaignRecord, u: BlocUtxos, pledge: { utxo: UTxO.UTxO; pledge: ValidPledge }, address: string, utxos: UTxO.UTxO[]): Promise<UnsignedTx>;
  /** Submit exact signed CBOR through Blockfrost. */
  submitSigned(txCbor: string): Promise<string>;
  awaitTx(txHash: string): Promise<boolean>;
}

/** Why the chain is not ready, or null if it is (Blockfrost key + seeds A and C present). */
export function chainReadiness(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    if (!blockfrostConfig(env)) return 'needs BLOCKFROST_PROJECT_ID (a Blockfrost preprod key) in the repo-root .env';
  } catch (e) {
    return (e as Error).message;
  }
  for (const s of ['A', 'C'] as const) {
    try {
      seedMnemonic(s);
    } catch (e) {
      return e instanceof PrerequisiteError ? e.message : String(e);
    }
  }
  return null;
}

const plainAda = (u: UTxO.UTxO) => u.scriptRef === undefined && Assets.hasOnlyLovelace(u.assets) && !(u as { datumOption?: unknown }).datumOption;

export function makeChain(bfConfig: BlockfrostConfig | null = blockfrostConfig()): ChainOps | null {
  if (!bfConfig || chainReadiness() !== null) return null;
  const bf: Blockfrost = blockfrost(bfConfig);
  const admin = () => account('bloc-admin');

  async function submit(who: { address: string }, built: { sign: () => Promise<{ submit: () => Promise<TransactionHash.TransactionHash> }> }) {
    const signed = await built.sign();
    return TransactionHash.toHex(await signed.submit());
  }

  return {
    tipMs: () => bf.tipMs(),
    awaitTx: (h) => awaitTx(bf, h, 300_000, 5_000),

    async createCampaign(n) {
      const a = admin();
      return serial(a.address, async () => {
        const client = a.signingClient(bfConfig);
        const utxos = (await client.getWalletUtxos()).filter(plainAda);
        const seedUtxo = utxos.sort((x, y) => Number(Assets.lovelaceOf(y.assets) - Assets.lovelaceOf(x.assets)))[0];
        if (!seedUtxo) throw new Error(`bloc-admin ${a.address} has no pure-ADA UTxO: fund it with ~30 tADA`);
        const seed = utxoRef(seedUtxo);
        const policy = campaignPolicy(seed);
        const bloc = blocScript(policy.hash);
        const address = blocAddress(bloc.hash, 0);
        const blocIdHex = Buffer.from(n.id, 'utf8').toString('hex');
        const itemHash = (await import('node:crypto')).createHash('sha256').update(n.item).digest('hex');
        const datum: CampaignDatum = {
          blocId: blocIdHex, itemHash, asset: ASSET_ADA, membersLimit: BigInt(n.membersLimit), minBatch: BigInt(n.minBatch),
          bidDeadline: BigInt(n.bidDeadline), refundDeadline: BigInt(n.refundDeadline), providerVkeys: n.providerVkeys,
        };
        const built = await applyCreateCampaign(client.newTx(), { seedUtxo, policy, bloc, blocAddress: address, datum, publishReferenceScript: n.publishReferenceScript })
          .build({ availableUtxos: utxos, changeAddress: a.ledgerAddress });
        const txHash = await submit(a, built);
        return {
          id: n.id, item: n.item, itemHash, asset: { ...ASSET_ADA, label: ASSET_LABEL }, unitLabel: UNIT_LABEL,
          membersLimit: n.membersLimit, minBatch: n.minBatch, bidDeadline: n.bidDeadline, refundDeadline: n.refundDeadline,
          providerVkeys: n.providerVkeys, policyId: policy.hash, blocHash: bloc.hash, blocIdHex, seed: { txHash: seed.txHash, index: Number(seed.index) },
          campaignTx: txHash, scriptAddress: address, state: 'open', marketPrice: MARKET_PRICE_LOVELACE.toString(), createdAt: Date.now(),
        };
      });
    },

    async pledgeFromWallet(walletName, c) {
      const w = account(walletName);
      return serial(w.address, async () => {
        const client = w.signingClient(bfConfig);
        const utxos = (await client.getWalletUtxos()).filter(plainAda);
        if (!utxos.length) throw new Error(`${walletName} has no tADA: fund it with ~5 tADA`);
        const datum = pledgeDatumFor(c, w.address);
        const built = await applyPledges(client.newTx(), c.scriptAddress, c.asset, [{ datum, lovelace: PLEDGE_LOCK_LOVELACE }])
          .build({ availableUtxos: utxos, changeAddress: w.ledgerAddress });
        return { txHash: await submit(w, built), outputIndex: 0, address: w.address };
      });
    },

    async simulateBatch(c, firstSim, count) {
      const t = account('treasury');
      return serial(t.address, async () => {
        const client = t.signingClient(bfConfig);
        const utxos = (await client.getWalletUtxos()).filter(plainAda);
        const outs = Array.from({ length: count }, (_, k) => {
          const sim = `sim-${firstSim + k}`;
          const refundAddress = account(sim).address;
          return { sim, refundAddress, datum: pledgeDatumFor(c, refundAddress), lovelace: PLEDGE_LOCK_LOVELACE };
        });
        const built = await applyPledges(client.newTx(), c.scriptAddress, c.asset, outs).build({ availableUtxos: utxos, changeAddress: t.ledgerAddress });
        const txHash = await submit(t, built);
        return { txHash, outputs: outs.map((o, k) => ({ outputIndex: k, sim: o.sim, refundAddress: o.refundAddress })) };
      });
    },

    async readBloc(c, info) {
      const client = admin().signingClient(bfConfig);
      const all = await client.getUtxos(Address.fromBech32(c.scriptAddress));
      const nftUnit = c.policyId + c.blocIdHex;
      const campaignUtxo = all.find((u) => Assets.getByUnit(u.assets, nftUnit) === 1n);
      if (!campaignUtxo) throw new Error(`campaign UTxO with ${nftUnit} not found at ${c.scriptAddress}`);
      const referenceScriptUtxo = pickReferenceScript(all, c.blocHash);
      const valid: BlocUtxos['valid'] = [], invalid: BlocUtxos['invalid'] = [], refundable: BlocUtxos['refundable'] = [];
      for (const u of all) {
        if (u === campaignUtxo || u === referenceScriptUtxo) continue;
        const r = validatePledge(info, chainPledgeOf(u, c.policyId, c.asset));
        if (r.ok) valid.push({ utxo: u, pledge: r.pledge });
        else invalid.push({ utxo: u, reason: r.reason });
        const rf = refundablePledgeOf(u, c.policyId, c.asset);
        if (rf) refundable.push(rf);
      }
      return { campaignUtxo, ...(referenceScriptUtxo ? { referenceScriptUtxo } : {}), valid, invalid, refundable };
    },

    async settle(c, u, batch, bid, signature) {
      const a = admin();
      return serial(a.address, async () => {
        const client = a.signingClient(bfConfig);
        const tip = await bf.tipMs();
        const end = [bid.expiry, BigInt(c.bidDeadline), tip + 20n * 60_000n].reduce((m, x) => (x < m ? x : m));
        const validTo = end - 1_000n;
        if (validTo <= tip) throw new Error('the bid or the bid deadline expires too soon to settle');
        const wallet = (await client.getWalletUtxos()).filter(plainAda);
        if (!wallet.length) throw new Error(`bloc-admin ${a.address} has no tADA for fees/collateral`);
        const built = await applySettle(client.newTx(), {
          bloc: blocScript(c.policyId), campaignPolicy: c.policyId, asset: c.asset, campaignUtxo: u.campaignUtxo,
          ...(u.referenceScriptUtxo ? { referenceScriptUtxo: u.referenceScriptUtxo } : {}),
          pledgeUtxos: u.valid.map((v) => v.utxo), batch, bid, signature, validTo,
        }).build({ availableUtxos: wallet, changeAddress: a.ledgerAddress });
        return submit(a, built);
      });
    },

    async refund(c, u, pledges) {
      const a = admin();
      return serial(a.address, async () => {
        const client = a.signingClient(bfConfig);
        const tip = await bf.tipMs();
        const validFrom = BigInt(c.refundDeadline) + 2_000n;
        if (tip <= validFrom) throw new Error(`refund deadline not reached on chain (tip ${new Date(Number(tip)).toISOString()})`);
        const wallet = (await client.getWalletUtxos()).filter(plainAda);
        if (!wallet.length) throw new Error(`bloc-admin ${a.address} has no tADA for fees/collateral`);
        const built = await applyRefund(client.newTx(), {
          bloc: blocScript(c.policyId), campaignUtxo: u.campaignUtxo, ...(u.referenceScriptUtxo ? { referenceScriptUtxo: u.referenceScriptUtxo } : {}),
          pledges, validFrom, validTo: tip + 20n * 60_000n,
        }).build({ availableUtxos: wallet, changeAddress: a.ledgerAddress });
        return submit(a, built);
      });
    },

    async buildUserPledge(c, address, utxos, datum) {
      const client = Client.make(preprod).withBlockfrost(bfConfig).withAddress(address);
      const built = await applyPledges(client.newTx(), c.scriptAddress, c.asset, [{ datum, lovelace: PLEDGE_LOCK_LOVELACE }])
        .build({ availableUtxos: utxos, changeAddress: Address.fromBech32(address) });
      return { txCbor: Transaction.toCBORHex(await built.toTransaction()) };
    },

    async buildUserRefund(c, u, pledge, address, utxos) {
      const tip = await bf.tipMs();
      const validFrom = BigInt(c.refundDeadline) + 2_000n;
      if (tip <= validFrom) throw new Error(`refund deadline not reached on chain (tip ${new Date(Number(tip)).toISOString()})`);
      const client = Client.make(preprod).withBlockfrost(bfConfig).withAddress(address);
      const built = await applyRefund(client.newTx(), {
        bloc: blocScript(c.policyId), campaignUtxo: u.campaignUtxo, ...(u.referenceScriptUtxo ? { referenceScriptUtxo: u.referenceScriptUtxo } : {}),
        pledges: [pledge], validFrom, validTo: tip + 20n * 60_000n,
      // Evolution defaults to 5 tADA collateral, which leaves a sub-min-UTxO collateral return on small wallets.
      // 2 tADA covers 150% of a one-pledge refund fee by a wide margin.
      }).build({ availableUtxos: utxos, changeAddress: Address.fromBech32(address), setCollateral: 2_000_000n });
      return { txCbor: Transaction.toCBORHex(await built.toTransaction()) };
    },

    submitSigned: (txCbor) => submitCbor(bfConfig, txCbor),
  };
}

export { plutusAddressFromBech32 };
