/**
 * Turns an EscrowTxPlan into an Evolution transaction:
 *  - spend the escrow UTxO with the plan's redeemer, script attached inline (no reference script);
 *  - outputs exactly as planned (continuation at the identical escrow address, tagged payouts);
 *  - required signer = datum principal; finite validity window from the plan;
 *  - fees, change and collateral from the actor's wallet UTxOs (Evolution picks pure-ADA collateral, 5 ADA target).
 * Nothing else may be sent to the escrow address in the same tx (research §4: every script output must parse).
 */
import { Address, Assets, InlineDatum, KeyHash, type UTxO } from '@evolution-sdk/evolution';
import type { BuildOptions, TransactionBuilderBase } from '@evolution-sdk/evolution/sdk/builders/TransactionBuilder';
import { ESCROW_ADDRESS, REGISTRY_POLICY_ID } from '../constants.js';
import { escrowScript } from './script.js';
import type { EscrowTxPlan } from './plan.js';

export type AnyTxBuilder<R> = TransactionBuilderBase & { build: (options?: BuildOptions) => Promise<R> };

export function applyPlan<B extends TransactionBuilderBase>(builder: B, p: EscrowTxPlan): B {
  let tx = builder
    .collectFrom({ inputs: [p.input.utxo], redeemer: p.redeemer })
    .attachScript({ script: escrowScript() })
    .addSigner({ keyHash: KeyHash.fromHex(p.signerVkh) })
    .setValidity({ from: p.validity.from, to: p.validity.to });
  for (const o of p.outputs) {
    tx = tx.payToAddress({ address: o.address, assets: o.assets, datum: new InlineDatum.InlineDatum({ data: o.datum }), autoMinUtxo: o.autoMinUtxo });
  }
  return tx;
}

/** Wallet UTxOs safe for coin selection and collateral: no escrow UTxOs, no ref scripts, no registry NFT. */
export function spendableWalletUtxos(utxos: ReadonlyArray<UTxO.UTxO>): UTxO.UTxO[] {
  return utxos.filter(
    (u) =>
      u.scriptRef === undefined &&
      Address.toBech32(u.address) !== ESCROW_ADDRESS &&
      !Assets.getUnits(u.assets).some((unit) => unit.startsWith(REGISTRY_POLICY_ID)),
  );
}

export async function buildPlan<R>(
  builder: AnyTxBuilder<R>,
  p: EscrowTxPlan,
  opts: { changeAddress: Address.Address; walletUtxos: ReadonlyArray<UTxO.UTxO> } & Omit<BuildOptions, 'changeAddress' | 'availableUtxos'>,
): Promise<R> {
  const { changeAddress, walletUtxos, ...rest } = opts;
  const available = spendableWalletUtxos(walletUtxos);
  if (!available.length) throw new Error(`${p.action}: the actor wallet has no spendable UTxO (fund it with tADA)`);
  return applyPlan(builder, p).build({ ...rest, changeAddress, availableUtxos: available });
}
