import { describe, expect, it } from 'vitest';
import { Data } from '@evolution-sdk/evolution';
import { buildMasumiLockDatum, masumiEscrowAddress, parseMasumiLockDatum } from '@x402/cardano';
import { ESCROW_ADDRESS, ESCROW_SCRIPT_HASH, REGISTRY_POLICY_ID } from '../src/constants.js';
import { escrowScript, registryScript, scriptAddress, scriptHashHex } from '../src/escrow/script.js';
import { decodeEscrowDatum, editDatum, encodeEscrowDatum, EscrowState, outputReferenceData, redeemerData, stateName, FIELD } from '../src/escrow/datum.js';
import { buyerAddr, lockFixture, sellerAddr } from './fixtures.js';

describe('vested_pay v2 script', () => {
  it('rebuilds the applied script with the canonical hash and address', () => {
    const s = escrowScript();
    expect(scriptHashHex(s)).toBe(ESCROW_SCRIPT_HASH);
    expect(scriptAddress(ESCROW_SCRIPT_HASH)).toBe(ESCROW_ADDRESS);
    expect(ESCROW_ADDRESS).toBe(masumiEscrowAddress('cardano:preprod'));
    expect(ESCROW_ADDRESS).toBe('addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g');
  });
  it('registry v2 policy id matches', () => {
    expect(scriptHashHex(registryScript())).toBe(REGISTRY_POLICY_ID);
  });
});

describe('datum codec', () => {
  it('round-trips x402 buildMasumiLock datum byte-for-byte', async () => {
    const { lock } = await lockFixture();
    const cbor = Data.toCBORHex(lock.datum.data);
    const view = decodeEscrowDatum(cbor)!;
    expect(view).not.toBeNull();
    expect(view.state).toBe(EscrowState.FundsLocked);
    expect(view.resultHash).toBe('');
    expect(Data.toCBORHex(encodeEscrowDatum(view))).toBe(cbor);
  });

  it('round-trips buildMasumiLockDatum with return addresses (Some) and enterprise/base mix', () => {
    const d = buildMasumiLockDatum({
      buyerAddress: buyerAddr, sellerAddress: sellerAddr, buyerReturnAddress: buyerAddr, sellerReturnAddress: sellerAddr,
      referenceKey: 'a4'.repeat(20), referenceSignature: '84'.repeat(40), sellerNonce: '11'.repeat(32), buyerNonce: '',
      agentIdentifier: '', collateralReturnLovelace: 1_435_230n, inputHash: '22'.repeat(32),
      payByTime: 1n, submitResultTime: 2n, unlockTime: 3n, externalDisputeUnlockTime: 4n,
    });
    const v = parseMasumiLockDatum(d)!;
    expect(v.buyerReturnAddress).not.toBeNull();
    expect(Data.toCBORHex(encodeEscrowDatum(v))).toBe(Data.toCBORHex(d));
  });

  it('editDatum changes only the requested fields', async () => {
    const { lock } = await lockFixture();
    const before = decodeEscrowDatum(lock.datum.data)!;
    const edited = editDatum(lock.datum.data, { resultHash: 'ab'.repeat(32), sellerCooldownTime: 99n, buyerCooldownTime: 0n, state: EscrowState.ResultSubmitted });
    const after = decodeEscrowDatum(edited)!;
    expect(after).toEqual({ ...before, resultHash: 'ab'.repeat(32), sellerCooldownTime: 99n, buyerCooldownTime: 0n, state: 1n });
    // untouched fields keep their exact Plutus data
    const f0 = (lock.datum.data as Data.Constr).fields;
    const f1 = (edited as Data.Constr).fields;
    for (let i = 0; i < 19; i++) {
      if ([FIELD.resultHash, FIELD.sellerCooldownTime, FIELD.buyerCooldownTime, FIELD.state].includes(i as never)) continue;
      expect(Data.toCBORHex(f1[i]!)).toBe(Data.toCBORHex(f0[i]!));
    }
  });

  it('encodes redeemers as fieldless Constr (tag 121+n)', () => {
    expect(Data.toCBORHex(redeemerData('Withdraw'))).toBe('d87980');
    expect(Data.toCBORHex(redeemerData('SetRefundRequested'))).toBe('d87a80');
    expect(Data.toCBORHex(redeemerData('WithdrawRefund'))).toBe('d87c80');
    expect(Data.toCBORHex(redeemerData('SubmitResult'))).toBe('d87e80');
    expect(Data.toCBORHex(redeemerData('AuthorizeRefund'))).toBe('d87f80');
  });

  it('encodes the payout tag as OutputReference Constr0[bytes32, int]', () => {
    const hex = Data.toCBORHex(outputReferenceData('ab'.repeat(32), 0));
    expect(hex.startsWith('d8799f5820' + 'ab'.repeat(32))).toBe(true);
    expect(hex.endsWith('00ff')).toBe(true);
  });

  it('names states', () => {
    expect(stateName(3n)).toBe('Disputed');
    expect(stateName(9n)).toBe('Unknown(9)');
  });
});
