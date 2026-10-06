/**
 * Named accounts from the three seeds (docs/BRIEF.md <cardano> "Wallets: three seeds, not one"), one CIP-1852 account
 * index per name, base addresses (payment + stake key of that account, address index 0), preprod network id 0.
 *
 *   Seed A: treasury=0, specialist-seller=1, bloc-admin=2
 *   Seed B: overpaid-buyer=0 (alias ombud-buyer), provider-1..3 = 1..3
 *   Seed C: room-001..room-150 = 1..150, sim-<n> = 1000+n
 *
 * A NamedAccount exposes addresses and signers but never its mnemonic: it lives in a private field, is not
 * enumerable, and is excluded from toJSON / util.inspect.
 */
import { inspect } from 'node:util';
import { Address, Assets, Client, preprod, type UTxO } from '@evolution-sdk/evolution';
import { addressFromSeed } from '@evolution-sdk/evolution/sdk/wallet/Derivation';
import { toClientCardanoSigner, toMasumiSellerSigner, type ClientCardanoSigner, type ClientCardanoSignerConfig } from '@x402/cardano';
import { NETWORK } from './constants.js';
import { seedMnemonic, type BlockfrostConfig, type SeedName } from './env.js';

export interface AccountSpec {
  name: string;
  seed: SeedName;
  accountIndex: number;
}

const FIXED: Record<string, Omit<AccountSpec, 'name'>> = {
  treasury: { seed: 'A', accountIndex: 0 },
  // The specialist runs on the tunnelled host, so it gets its own seed (S), never seed A.
  'specialist-seller': { seed: 'S', accountIndex: 0 },
  'specialist-seller-legacy': { seed: 'A', accountIndex: 1 },
  'bloc-admin': { seed: 'A', accountIndex: 2 },
  'overpaid-buyer': { seed: 'B', accountIndex: 0 },
  'ombud-buyer': { seed: 'B', accountIndex: 0 },
  'provider-1': { seed: 'B', accountIndex: 1 },
  'provider-2': { seed: 'B', accountIndex: 2 },
  'provider-3': { seed: 'B', accountIndex: 3 },
};

export function accountSpec(name: string): AccountSpec {
  const fixed = FIXED[name];
  if (fixed) return { name, ...fixed };
  const room = /^room-(\d{3})$/.exec(name);
  if (room) {
    const n = Number(room[1]);
    if (n >= 1 && n <= 150) return { name, seed: 'C', accountIndex: n };
  }
  const sim = /^sim-(\d{1,6})$/.exec(name);
  if (sim) return { name, seed: 'C', accountIndex: 1000 + Number(sim[1]) };
  throw new Error(`unknown wallet name "${name}"`);
}

export const CORE_ACCOUNTS = ['treasury', 'specialist-seller', 'bloc-admin', 'overpaid-buyer', 'provider-1', 'provider-2', 'provider-3'] as const;

const normalize = (m: string) => m.trim().replace(/\s+/g, ' ').toLowerCase();

export class NamedAccount {
  readonly name: string;
  readonly seed: SeedName;
  readonly accountIndex: number;
  readonly address: string;
  readonly paymentKeyHash: string;
  readonly stakeKeyHash: string | null;
  readonly #mnemonic: string;

  constructor(spec: AccountSpec, mnemonic: string) {
    this.name = spec.name;
    this.seed = spec.seed;
    this.accountIndex = spec.accountIndex;
    this.#mnemonic = normalize(mnemonic);
    const { address } = addressFromSeed(this.#mnemonic, { accountIndex: spec.accountIndex, networkId: 0, addressType: 'Base' });
    this.address = Address.toBech32(address);
    this.paymentKeyHash = Buffer.from((address.paymentCredential as { hash: Uint8Array }).hash).toString('hex');
    const st = address.stakingCredential as { hash: Uint8Array } | undefined;
    this.stakeKeyHash = st ? Buffer.from(st.hash).toString('hex') : null;
  }

  get ledgerAddress(): Address.Address {
    return Address.fromBech32(this.address);
  }

  /** Evolution signing client (Blockfrost + seed wallet for this account). */
  signingClient(bf: BlockfrostConfig) {
    return Client.make(preprod).withBlockfrost(bf).withSeed({ mnemonic: this.#mnemonic, accountIndex: this.accountIndex, addressType: 'Base' });
  }

  /** @x402/cardano reference client signer for this account. */
  x402ClientSigner(bf: BlockfrostConfig, extra: Partial<Omit<ClientCardanoSignerConfig, 'mnemonic' | 'network' | 'provider' | 'accountIndex'>> = {}): ClientCardanoSigner {
    return toClientCardanoSigner({
      mnemonic: this.#mnemonic, network: NETWORK, accountIndex: this.accountIndex,
      provider: { blockfrost: bf, requestTimeoutMs: 20_000 }, ...extra,
    });
  }

  /** Masumi terms signer (CIP-8 over termsDigest) for this account, used by the seller's 402 issuer. */
  masumiSeller() {
    const s = toMasumiSellerSigner({ mnemonic: this.#mnemonic, network: NETWORK, accountIndex: this.accountIndex });
    if (s.sellerAddress !== this.address) throw new Error(`masumi seller address ${s.sellerAddress} != derived ${this.address}`);
    return s;
  }

  toJSON() {
    return { name: this.name, seed: this.seed, accountIndex: this.accountIndex, address: this.address, paymentKeyHash: this.paymentKeyHash };
  }
  [inspect.custom]() {
    return `NamedAccount(${this.name} ${this.address})`;
  }
}

const cache = new Map<string, NamedAccount>();
/** Derive a named account. Throws PrerequisiteError if its seed is missing. */
export function account(name: string): NamedAccount {
  const spec = accountSpec(name);
  const key = `${spec.seed}:${spec.accountIndex}`;
  let a = cache.get(key);
  if (!a || a.name !== name) {
    a = new NamedAccount(spec, seedMnemonic(spec.seed));
    cache.set(key, a);
  }
  return a;
}

/** Same as account() but from an explicit mnemonic (tests, tooling). */
export function accountFromMnemonic(name: string, mnemonic: string): NamedAccount {
  return new NamedAccount(accountSpec(name), mnemonic);
}

export const lovelaceOfUtxos = (utxos: ReadonlyArray<UTxO.UTxO>) =>
  utxos.reduce((s, u) => s + Assets.lovelaceOf(u.assets), 0n);
