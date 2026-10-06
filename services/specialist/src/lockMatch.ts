/**
 * Is this escrow UTxO the payment for this job? Anyone can create escrow UTxOs with any datum (the seller nonce is
 * public), so we accept a lock only if it is an output of the tx our facilitator verified AND every datum field the
 * seller decided equals what we signed. The buyer chooses only `buyer`, `buyer_return_address` and
 * `collateral_return_lovelace` (which must be covered by the UTxO).
 */
import { addressCredentials, type MasumiAddressCredentials } from '@x402/cardano';
import type { EscrowCandidate } from '@overpaid/cardano';
import type { ExpectedLock } from './jobs.js';

const sameCreds = (a: MasumiAddressCredentials, bech32: string) => {
  const b = addressCredentials(bech32);
  return a.payment.hash === b.payment.hash && a.payment.isScript === b.payment.isScript &&
    a.stake?.hash === b.stake?.hash && a.stake?.isScript === b.stake?.isScript && !a.pointer && !b.pointer;
};

export function lockMismatch(c: EscrowCandidate, e: ExpectedLock): string | null {
  const d = c.datum;
  if (!d) return 'no parsable vested_pay datum';
  if (c.txHash !== e.txHash) return 'not the verified lock transaction';
  if (c.consumedBy) return 'already spent';
  if (c.hasReferenceScript) return 'carries a reference script';
  const checks: Array<[boolean, string]> = [
    [sameCreds(d.seller, e.sellerAddress), 'seller'],
    [d.sellerReturnAddress === null, 'seller_return_address'],
    [d.referenceKey === e.referenceKey, 'reference_key'],
    [d.referenceSignature === e.referenceSignature, 'reference_signature'],
    [d.sellerNonce === e.sellerNonce, 'seller_nonce'],
    [d.buyerNonce === e.buyerNonce, 'buyer_nonce'],
    [d.agentIdentifier === e.agentIdentifier, 'agent_identifier'],
    [d.inputHash === e.inputHash, 'input_hash'],
    [d.resultHash === '', 'result_hash'],
    [d.payByTime === BigInt(e.payByTime), 'pay_by_time'],
    [d.submitResultTime === BigInt(e.submitResultTime), 'submit_result_time'],
    [d.unlockTime === BigInt(e.unlockTime), 'unlock_time'],
    [d.externalDisputeUnlockTime === BigInt(e.externalDisputeUnlockTime), 'external_dispute_unlock_time'],
    [d.sellerCooldownTime === 0n, 'seller_cooldown_time'],
    [d.buyerCooldownTime === 0n, 'buyer_cooldown_time'],
    [d.state === 0n, 'state'],
    [d.collateralReturnLovelace >= 0n && d.collateralReturnLovelace <= c.lovelace, 'collateral_return_lovelace'],
    [!d.buyer.pointer && !d.buyer.payment.isScript && !d.buyerReturnAddress?.pointer, 'buyer address kind'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) return `datum field ${failed[1]} differs from the signed terms`;
  if (e.unit !== 'lovelace') return `unsupported price unit ${e.unit}`;
  const paid = c.lovelace - d.collateralReturnLovelace;
  return paid >= BigInt(e.amount) ? null : 'underpaid';
}

export const findLock = (cands: EscrowCandidate[], e: ExpectedLock) => cands.find((c) => lockMismatch(c, e) === null) ?? null;
