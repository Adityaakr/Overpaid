import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { toMasumiSellerSigner, verifyMasumiAuthorization, type CardanoExtraMasumi } from '@x402/cardano';
import { hashCanonical, sha256Hex, canonicalJson } from '@overpaid/shared';
import { accountFromMnemonic, accountSpec } from '../src/wallets.js';
import { checkMasumiQuote, HireError, taskInputHash, withResource } from '../src/buyer.js';
import { parseDotenv } from '../src/env.js';
import { ESCROW_ADDRESS } from '../src/constants.js';
import { SELLER_MNEMONIC, signedQuote } from './fixtures.js';

describe('named accounts', () => {
  it('maps names to seed + account index', () => {
    expect(accountSpec('treasury')).toEqual({ name: 'treasury', seed: 'A', accountIndex: 0 });
    expect(accountSpec('specialist-seller')).toMatchObject({ seed: 'S', accountIndex: 0 });
    expect(accountSpec('specialist-seller-legacy')).toMatchObject({ seed: 'A', accountIndex: 1 });
    expect(accountSpec('bloc-admin')).toMatchObject({ seed: 'A', accountIndex: 2 });
    expect(accountSpec('overpaid-buyer')).toMatchObject({ seed: 'B', accountIndex: 0 });
    expect(accountSpec('provider-3')).toMatchObject({ seed: 'B', accountIndex: 3 });
    expect(accountSpec('room-001')).toMatchObject({ seed: 'C', accountIndex: 1 });
    expect(accountSpec('room-150')).toMatchObject({ seed: 'C', accountIndex: 150 });
    expect(accountSpec('sim-7')).toMatchObject({ seed: 'C', accountIndex: 1007 });
    expect(() => accountSpec('room-151')).toThrow();
    expect(() => accountSpec('nobody')).toThrow();
  });
  it('derives the same address as x402 masumi seller signer, distinct per account, without exposing the mnemonic', () => {
    const seller = accountFromMnemonic('specialist-seller', SELLER_MNEMONIC);
    const treasury = accountFromMnemonic('provider-1', SELLER_MNEMONIC);
    expect(seller.address).toBe(toMasumiSellerSigner({ mnemonic: SELLER_MNEMONIC, network: 'cardano:preprod', accountIndex: 0 }).sellerAddress);
    expect(seller.masumiSeller().sellerAddress).toBe(seller.address);
    expect(seller.address).not.toBe(treasury.address);
    expect(seller.address.startsWith('addr_test1q')).toBe(true);
    const words = SELLER_MNEMONIC.split(' ');
    for (const s of [JSON.stringify(seller), inspect(seller, { showHidden: true, depth: 5 }), String(Object.values(seller))]) {
      expect(s).not.toContain(words.slice(0, 3).join(' '));
    }
  });
  it('x402 client signer reports the same address', () => {
    const buyer = accountFromMnemonic('overpaid-buyer', SELLER_MNEMONIC);
    expect(buyer.x402ClientSigner({ baseUrl: 'https://invalid.example', projectId: 'preprodX' }).getAddress()).toBe(buyer.address);
  });
});

describe('dotenv parsing', () => {
  it('handles quotes and comments', () => {
    expect(parseDotenv('# c\nSEED_A="a b c"\nexport SEED_B=\'x y\'\nK=v # tail\nEMPTY=')).toEqual({ SEED_A: 'a b c', SEED_B: 'x y', K: 'v', EMPTY: '' });
  });
});

describe('buyer quote checks', () => {
  const task = { merchant: 'skylane', booking_ref: 'SKX7Q2' };
  it('input hash = SHA-256 of the RFC 8785 canonical task spec', () => {
    expect(taskInputHash({ b: 1, a: 'x' })).toBe(sha256Hex('{"a":"x","b":1}'));
    expect(taskInputHash(task)).toBe(hashCanonical(task));
  });
  it('accepts a quote committing to our exact body; rejects a different body, a high price, or a foreign payTo', async () => {
    const { reqs } = await signedQuote(task);
    const required = { x402Version: 2, resource: { url: 'http://x/x402/start_job' }, accepts: [reqs] } as never;
    expect(checkMasumiQuote(required, task, 5_000_000n).payTo).toBe(ESCROW_ADDRESS);
    expect(() => checkMasumiQuote(required, { ...task, booking_ref: 'ZZZZZZ' }, 5_000_000n)).toThrow(HireError);
    expect(() => checkMasumiQuote(required, task, 4_999_999n)).toThrow(/exceeds cap/);
    const foreign = { x402Version: 2, resource: { url: 'x' }, accepts: [{ ...reqs, payTo: 'addr_test1wqsztux7' }] } as never;
    expect(() => checkMasumiQuote(foreign, task, 5_000_000n)).toThrow(/canonical vested_pay/);
    expect(canonicalJson(task)).toBe('{"booking_ref":"SKX7Q2","merchant":"skylane"}');
  });
  it("the seller's quote passes x402's own client-side authorization check", async () => {
    const { reqs } = await signedQuote(task);
    const r = await verifyMasumiAuthorization(reqs.extra as unknown as CardanoExtraMasumi, reqs, { requireAllPartContent: true });
    expect(r.ok).toBe(true);
  });
  it('withResource injects the protected resource into sign input', async () => {
    let seen: unknown;
    const inner = { getAddress: () => 'a', buildAndSignPaymentTransaction: (i: unknown) => { seen = i; return { transaction: '', nonce: '' }; } };
    await withResource(inner, { url: 'https://s/x' } as never).buildAndSignPaymentTransaction({ network: 'n', payTo: 'p', asset: 'lovelace', amount: '1', maxTimeoutSeconds: 1 });
    expect((seen as { resource: { url: string } }).resource.url).toBe('https://s/x');
  });
});
