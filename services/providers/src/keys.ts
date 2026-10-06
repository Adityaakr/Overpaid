/**
 * Provider bid keys. The bloc contract verifies plain ed25519 (RFC 8032) over the fixed-layout bid message with a
 * 32-byte public key from the campaign allowlist, and @overpaid/bloc-contract's signBid takes the 32-byte secret seed.
 * Cardano wallet keys are BIP32-Ed25519 *extended* keys (no 32-byte seed), so each provider's bid key is derived
 * deterministically from seed B instead:  sk = HMAC-SHA256(key = normalised seed B mnemonic, "overpaid/bloc-bid/v1/<name>").
 * The payout address in the bid is the provider's normal seed-B wallet address (account provider-N).
 */
import { createHmac } from 'node:crypto';
import { vkeyFromSecret } from '@overpaid/bloc-contract';
import { accountFromMnemonic, seedMnemonic } from '@overpaid/cardano';

export interface ProviderKeys {
  name: string;
  secretKey: Uint8Array;
  vkey: string;
  address: string;
}

const normalize = (m: string) => m.trim().replace(/\s+/g, ' ').toLowerCase();

export function bidSecret(name: string, mnemonic: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', normalize(mnemonic)).update(`overpaid/bloc-bid/v1/${name}`).digest());
}

export function providerKeys(name: string, mnemonic: string = seedMnemonic('B')): ProviderKeys {
  const secretKey = bidSecret(name, mnemonic);
  return { name, secretKey, vkey: vkeyFromSecret(secretKey), address: accountFromMnemonic(name, mnemonic).address };
}
