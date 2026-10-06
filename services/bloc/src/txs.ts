/**
 * Transaction shapes for the bloc contract, applied to any Evolution builder (online signing client or the offline
 * `makeTxBuilder` used by tests and scripts/capacity.ts). Follows contracts/bloc/README.md "Building transactions":
 *
 * settle: ref inputs = campaign UTxO (+ reference script); inputs = pledges with spend redeemer
 *         Settle{input_index, 0} (Self redeemer -> final sorted index); withdraw 0 from the bloc credential with
 *         SettleRedeemer{bid, signature, pairs} built after coin selection (Batch redeemer); outputs #0 provider
 *         (inline datum = campaign policy bytes), #1.. refunds in pledge input order (inline datum = pledge out-ref),
 *         change last (Evolution appends it); validTo <= min(bid.expiry, bid_deadline).
 * refund: validFrom > refund_deadline, campaign as reference input, Refund{input_index, output_index} per pledge,
 *         whole value back to member_refund_address with the out-ref datum.
 *
 * Redeemers are passed as Evolution Data (the ledger CBOR encoder keeps `pairs` a real map). Never route them
 * through CBOR.AIKEN_DEFAULT_OPTIONS (maps become pair lists).
 */
import { Address, Assets, Data as EvoData, InlineDatum, ScriptHash, TransactionHash, type UTxO } from '@evolution-sdk/evolution';
import type { TransactionBuilderBase } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import type { IndexedInput } from '@evolution-sdk/evolution/sdk/builders/RedeemerBuilder';
import {
  blocStakeCredential, campaignDatumData, decodePledgeDatum, campaignMintRedeemer, outRefData, pledgeDatumData, plutusAddressToBech32,
  providerOutputDatum, publishRedeemer, refundOutputDatum, refundSpendRedeemer, settleRedeemerData, settleSpendRedeemer,
  type AppliedScript, type Bid, type CampaignDatum, type Hex, type OutRef, type PledgeDatum,
} from '@overpaid/bloc-contract';
import { isAda, refKey, settlePairs, type ChainPledge, type SettlementBatch, type ValidPledge } from './planner.js';

const inline = (d: EvoData.Data) => new InlineDatum.InlineDatum({ data: d });
export const utxoRef = (u: UTxO.UTxO): OutRef => ({ txHash: TransactionHash.toHex(u.transactionId), index: Number(u.index) });

/** Evolution UTxO at the bloc address -> planner input. */
export function chainPledgeOf(u: UTxO.UTxO, campaignPolicy: Hex, asset: { policy: Hex; name: Hex }): ChainPledge {
  const d = (u as { datumOption?: unknown }).datumOption;
  return {
    ref: utxoRef(u),
    lovelace: Assets.lovelaceOf(u.assets),
    assetQty: isAda(asset) ? undefined : Assets.getByUnit(u.assets, asset.policy + asset.name),
    datum: d instanceof InlineDatum.InlineDatum ? d.data : null,
    holdsCampaignToken: Assets.getUnits(u.assets).some((unit) => unit.startsWith(campaignPolicy)),
  };
}

/**
 * The reference-script UTxO to use for the bloc script: only one whose script hash IS the bloc script hash (and that
 * carries no datum). Anyone can park a UTxO with some other reference script at the bloc address; using it would make
 * every settle/refund fail, so anything else is ignored and the script is attached inline instead.
 */
export function pickReferenceScript(utxos: ReadonlyArray<UTxO.UTxO>, blocHash: Hex): UTxO.UTxO | undefined {
  return utxos.find((u) => {
    if (u.scriptRef === undefined || (u as { datumOption?: unknown }).datumOption) return false;
    try {
      return ScriptHash.toHex(ScriptHash.fromScript(u.scriptRef)).toLowerCase() === blocHash.toLowerCase();
    } catch {
      return false;
    }
  });
}

/**
 * A UTxO the permissionless Refund path can return: inline datum that parses as a PledgeDatum (any bloc id, any price)
 * and no campaign-policy token. `locked` is informational.
 */
export function refundablePledgeOf(u: UTxO.UTxO, campaignPolicy: Hex, asset: { policy: Hex; name: Hex }): { utxo: UTxO.UTxO; pledge: ValidPledge } | null {
  const p = chainPledgeOf(u, campaignPolicy, asset);
  if (p.holdsCampaignToken || !p.datum) return null;
  try {
    const datum = decodePledgeDatum(p.datum);
    return { utxo: u, pledge: { ref: p.ref, lovelace: p.lovelace, locked: isAda(asset) ? p.lovelace : (p.assetQty ?? 0n), datum } };
  } catch {
    return null;
  }
}

function assetsOf(lovelace: bigint, asset: { policy: Hex; name: Hex }, qty: bigint): Assets.Assets {
  return isAda(asset) || qty === 0n ? Assets.fromLovelace(lovelace) : Assets.fromHexStrings(asset.policy, asset.name, qty, lovelace);
}

// ---------------------------------------------------------------------------------------------- campaign

export interface CampaignTxArgs {
  seedUtxo: UTxO.UTxO;
  policy: AppliedScript;
  bloc: AppliedScript;
  blocAddress: string;
  datum: CampaignDatum;
  /** Also lock the applied bloc script as a reference-script UTxO at the bloc address (never spendable: no datum). */
  publishReferenceScript?: boolean;
}

/** Mint the one-shot campaign NFT, lock it at the bloc address with the campaign datum, register the bloc credential. */
export function applyCreateCampaign<B extends TransactionBuilderBase>(b: B, a: CampaignTxArgs): B {
  const nft = Assets.fromHexStrings(a.policy.hash, a.datum.blocId, 1n, 0n);
  let tx = b
    .collectFrom({ inputs: [a.seedUtxo] })
    .mintAssets({ assets: nft, redeemer: campaignMintRedeemer })
    .attachScript({ script: a.policy.script })
    .payToAddress({ address: Address.fromBech32(a.blocAddress), assets: Assets.fromHexStrings(a.policy.hash, a.datum.blocId, 1n, 2_000_000n), datum: inline(campaignDatumData(a.datum)), autoMinUtxo: true })
    .registerStake({ stakeCredential: blocStakeCredential(a.bloc.hash), redeemer: publishRedeemer })
    .attachScript({ script: a.bloc.script });
  if (a.publishReferenceScript) {
    tx = tx.payToAddress({ address: Address.fromBech32(a.blocAddress), assets: Assets.fromLovelace(0n), script: a.bloc.script, autoMinUtxo: true });
  }
  return tx;
}

// ---------------------------------------------------------------------------------------------- pledges

export interface PledgeOutput {
  datum: PledgeDatum;
  lovelace: bigint;
  assetQty?: bigint;
}

/** One or many pledge outputs (room pledge = 1, simulated batch ~ 60) to the bloc address with inline datums. */
export function applyPledges<B extends TransactionBuilderBase>(b: B, blocAddress: string, asset: { policy: Hex; name: Hex }, outs: PledgeOutput[]): B {
  let tx = b;
  const addr = Address.fromBech32(blocAddress);
  for (const o of outs) {
    tx = tx.payToAddress({ address: addr, assets: assetsOf(o.lovelace, asset, o.assetQty ?? 0n), datum: inline(pledgeDatumData(o.datum)), autoMinUtxo: false });
  }
  return tx;
}

// ---------------------------------------------------------------------------------------------- settle

export interface SettleTxArgs {
  bloc: AppliedScript;
  campaignPolicy: Hex;
  asset: { policy: Hex; name: Hex };
  campaignUtxo: UTxO.UTxO;
  /** UTxO carrying the bloc script as a reference script; if absent the script is attached inline. */
  referenceScriptUtxo?: UTxO.UTxO;
  /** The chain UTxOs for batch.pledges (any order). */
  pledgeUtxos: UTxO.UTxO[];
  batch: SettlementBatch;
  bid: Bid;
  signature: Hex;
  validTo: bigint;
  networkId?: number;
}

export function applySettle<B extends TransactionBuilderBase>(b: B, a: SettleTxArgs): B {
  const byRef = new Map(a.pledgeUtxos.map((u) => [refKey(utxoRef(u)), u]));
  const inputs = a.batch.pledges.map((p) => {
    const u = byRef.get(refKey(p.ref));
    if (!u) throw new Error(`missing chain UTxO for pledge ${refKey(p.ref)}`);
    return u;
  });
  const refs = a.referenceScriptUtxo ? [a.campaignUtxo, a.referenceScriptUtxo] : [a.campaignUtxo];
  let tx = b
    .readFrom({ referenceInputs: refs })
    .collectFrom({ inputs, redeemer: (inp: IndexedInput) => settleSpendRedeemer(inp.index, 0) })
    .withdraw({
      stakeCredential: blocStakeCredential(a.bloc.hash),
      amount: 0n,
      redeemer: {
        inputs,
        all: (indexed: ReadonlyArray<IndexedInput>) => {
          const idx = new Map(indexed.map((x) => [refKey(utxoRef(x.utxo)), x.index]));
          return settleRedeemerData({ bid: a.bid, signature: a.signature, pairs: settlePairs(idx, a.batch) });
        },
      },
    });
  if (!a.referenceScriptUtxo) tx = tx.attachScript({ script: a.bloc.script });
  // #0 provider
  tx = tx.payToAddress({
    address: Address.fromBech32(plutusAddressToBech32(a.bid.providerAddress, a.networkId ?? 0)),
    assets: assetsOf(isAda(a.asset) ? a.batch.providerTotal : 0n, a.asset, isAda(a.asset) ? 0n : a.batch.providerTotal),
    datum: inline(providerOutputDatum(a.campaignPolicy)),
    autoMinUtxo: true,
  });
  // #1.. refunds, in pledge input order
  for (const r of a.batch.refunds) {
    tx = tx.payToAddress({
      address: Address.fromBech32(plutusAddressToBech32(r.address, a.networkId ?? 0)),
      assets: assetsOf(r.lovelace, a.asset, r.asset),
      datum: inline(refundOutputDatum(r.ref)),
      autoMinUtxo: true,
    });
  }
  return tx.setValidity({ to: a.validTo });
}

// ---------------------------------------------------------------------------------------------- refund

export interface RefundTxArgs {
  bloc: AppliedScript;
  campaignUtxo: UTxO.UTxO;
  referenceScriptUtxo?: UTxO.UTxO;
  pledges: Array<{ utxo: UTxO.UTxO; pledge: ValidPledge }>;
  validFrom: bigint;
  validTo: bigint;
  networkId?: number;
}

export function applyRefund<B extends TransactionBuilderBase>(b: B, a: RefundTxArgs): B {
  const outIndex = new Map(a.pledges.map((p, k) => [refKey(p.pledge.ref), k]));
  const refs = a.referenceScriptUtxo ? [a.campaignUtxo, a.referenceScriptUtxo] : [a.campaignUtxo];
  let tx = b
    .readFrom({ referenceInputs: refs })
    .collectFrom({
      inputs: a.pledges.map((p) => p.utxo),
      redeemer: (inp: IndexedInput) => refundSpendRedeemer(inp.index, outIndex.get(refKey(utxoRef(inp.utxo)))!),
    });
  if (!a.referenceScriptUtxo) tx = tx.attachScript({ script: a.bloc.script });
  for (const p of a.pledges) {
    tx = tx.payToAddress({
      address: Address.fromBech32(plutusAddressToBech32(p.pledge.datum.memberRefundAddress, a.networkId ?? 0)),
      assets: p.utxo.assets,
      datum: inline(refundOutputDatum(p.pledge.ref)),
      autoMinUtxo: false,
    });
  }
  return tx.setValidity({ from: a.validFrom, to: a.validTo });
}

export { outRefData };
