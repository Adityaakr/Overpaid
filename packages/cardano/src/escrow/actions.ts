/**
 * Online escrow actions: locate the escrow's current UTxO, plan against chain time, build with Evolution
 * (Blockfrost evaluates the scripts during build, so a validator failure throws before signing), sign, submit,
 * and optionally wait for inclusion. Transactions from one wallet run one at a time.
 */
import { TransactionHash } from '@evolution-sdk/evolution';
import { txUrl } from '../constants.js';
import { awaitTx, blockfrost as makeBlockfrost, type Blockfrost } from '../provider.js';
import type { NamedAccount } from '../wallets.js';
import { buildPlan } from './build.js';
import {
  planAuthorizeRefund, planSetRefundRequested, planSubmitResult, planWithdraw, planWithdrawRefund,
  type EscrowAction, type EscrowTxPlan, type EscrowUtxo,
} from './plan.js';
import { followEscrow, loadEscrowUtxo, type EscrowStatus } from './reader.js';
import { stateName } from './datum.js';

const queues = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  queues.set(key, run.catch(() => {}));
  return run;
}

export interface EscrowRef {
  /** The lock tx hash (or any tx in the escrow's chain). */
  txHash: string;
  /** Disambiguates if a tx holds several escrows. */
  referenceSignature?: string;
}

export interface ActionResult {
  action: EscrowAction;
  txHash: string;
  explorerUrl: string;
  fromState: string;
  toState: string | null;
  validity: { from: string; to: string };
  confirmed: boolean;
  /** For continuation txs: the cooldown written into the new datum. */
  sellerCooldownTime?: string;
  buyerCooldownTime?: string;
}

export interface ActionOptions {
  bf?: Blockfrost;
  awaitConfirmation?: boolean;
  onSubmitted?: (txHash: string) => void;
}

type Planner = (e: EscrowUtxo, vkh: string, tip: bigint) => EscrowTxPlan;

async function run(action: EscrowAction, who: NamedAccount, ref: EscrowRef, planner: Planner, opts: ActionOptions): Promise<ActionResult> {
  const bf = opts.bf ?? makeBlockfrost();
  return serial(who.address, async () => {
    const status = await followEscrow(bf, ref.txHash, ref.referenceSignature);
    if (status.status !== 'open') throw new Error(`${action}: escrow is ${status.status}${status.status === 'closed' ? ` (closed by ${status.closedBy})` : ''}`);
    const client = who.signingClient(bf.config);
    const [escrow, tip, walletUtxos] = await Promise.all([loadEscrowUtxo(client, status.current), bf.tipMs(), client.getWalletUtxos()]);
    const plan = planner(escrow, who.paymentKeyHash, tip);
    const built = await buildPlan(client.newTx(), plan, { changeAddress: who.ledgerAddress, walletUtxos });
    const signed = await built.sign();
    const txHash = TransactionHash.toHex(await signed.submit());
    opts.onSubmitted?.(txHash);
    const confirmed = opts.awaitConfirmation === false ? false : await awaitTx(bf, txHash);
    return {
      action, txHash, explorerUrl: txUrl(txHash), fromState: stateName(plan.fromState), toState: plan.toState === null ? null : stateName(plan.toState),
      validity: { from: plan.validity.from.toString(), to: plan.validity.to.toString() }, confirmed,
      ...(plan.newDatum ? { sellerCooldownTime: plan.newDatum.sellerCooldownTime.toString(), buyerCooldownTime: plan.newDatum.buyerCooldownTime.toString() } : {}),
    };
  });
}

/** Seller: SubmitResult with a 32-byte hex result hash. */
export const submitResult = (seller: NamedAccount, ref: EscrowRef, resultHash: string, opts: ActionOptions = {}) =>
  run('SubmitResult', seller, ref, (e, vkh, tip) => planSubmitResult(e, vkh, resultHash, tip), opts);
/** Seller: Withdraw (collect) after unlock_time, or from WithdrawAuthorized. */
export const withdraw = (seller: NamedAccount, ref: EscrowRef, opts: ActionOptions = {}) => run('Withdraw', seller, ref, planWithdraw, opts);
/** Seller: AuthorizeRefund (dispute path b). */
export const authorizeRefund = (seller: NamedAccount, ref: EscrowRef, opts: ActionOptions = {}) => run('AuthorizeRefund', seller, ref, planAuthorizeRefund, opts);
/** Buyer: SetRefundRequested (before unlock_time; with a result hash this opens a dispute; cannot be undone). */
export const setRefundRequested = (buyer: NamedAccount, ref: EscrowRef, opts: ActionOptions = {}) => run('SetRefundRequested', buyer, ref, planSetRefundRequested, opts);
/** Buyer: WithdrawRefund (empty result hash; after submit_result_time unless RefundAuthorized). */
export const withdrawRefund = (buyer: NamedAccount, ref: EscrowRef, opts: ActionOptions = {}) => run('WithdrawRefund', buyer, ref, planWithdrawRefund, opts);

export async function escrowStatus(ref: EscrowRef, bf: Blockfrost = makeBlockfrost()): Promise<EscrowStatus> {
  return followEscrow(bf, ref.txHash, ref.referenceSignature);
}
