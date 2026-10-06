/**
 * Masumi registry V2 listing (docs/research/x402-masumi.md "Registration"): mint +1 of policy 67ab0c92…bd0b with
 * asset name 0x10 ‖ blake2b_224(seedTxHash ‖ u32be(seedIndex)) ‖ 000000 (redeemer MintAction = Constr 0 []),
 * send it (+2 ADA) to the seller, attach label-721 metadata, seller as required signer.
 * Registration is optional for x402 (unregistered offers skip every registry check); it only affects discovery.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { Address, Assets, Data, KeyHash, TransactionHash, type TransactionMetadatum, type UTxO } from '@evolution-sdk/evolution';
import { ESCROW_ADDRESS, REGISTRY_POLICY_ID } from './constants.js';
import { registryScript } from './escrow/script.js';
import { spendableWalletUtxos } from './escrow/build.js';
import type { BlockfrostConfig } from './env.js';
import type { NamedAccount } from './wallets.js';

export function registryAssetName(seedTxHash: string, seedIndex: number): string {
  const ref = Buffer.concat([Buffer.from(seedTxHash, 'hex'), Buffer.alloc(4)]);
  ref.writeUInt32BE(seedIndex, 32);
  return `10${Buffer.from(blake2b(ref, { dkLen: 28 })).toString('hex')}000000`;
}

/** Cardano metadata strings are limited to 64 bytes; Masumi chunks at 60. */
export function metadataChunks(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (Buffer.byteLength(cur + ch) > 60) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export interface AgentListing {
  name: string;
  description: string;
  apiBaseUrl: string;
  authorName: string;
  tags: string[];
  image: string;
  /** Fixed price: asset unit as policyHex+nameHex, or "lovelace". */
  priceAsset: string;
  priceAmount: bigint;
}

export function registryMetadata(a: AgentListing) {
  if (a.priceAmount <= 0n) throw new Error('price must be positive');
  const url = new URL(a.apiBaseUrl);
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('apiBaseUrl must be a public https URL (the registry rejects private/localhost URLs)');
  }
  for (const t of a.tags) if (!t || Buffer.byteLength(t) > 64) throw new Error(`tag "${t}" must be 1-64 bytes`);
  return {
    name: metadataChunks(a.name),
    description: metadataChunks(a.description),
    api_base_url: metadataChunks(a.apiBaseUrl.replace(/\/+$/, '')),
    author: { name: metadataChunks(a.authorName) },
    tags: a.tags,
    image: metadataChunks(a.image),
    metadata_version: '2',
    supported_payment_sources: [
      {
        chain: metadataChunks('Cardano'),
        network: metadataChunks('Preprod'),
        settlement: { paymentSourceType: metadataChunks('Web3CardanoV2'), address: metadataChunks(ESCROW_ADDRESS) },
        pricing: { pricingType: 'Fixed', fixed: [{ asset: metadataChunks(a.priceAsset), amount: a.priceAmount.toString() }] },
      },
    ],
  };
}

export function toMetadatum(v: unknown): TransactionMetadatum.TransactionMetadatum {
  if (typeof v === 'string') {
    if (Buffer.byteLength(v) > 64) throw new Error(`metadata string over 64 bytes: ${v.slice(0, 20)}…`);
    return v;
  }
  if (typeof v === 'number' || typeof v === 'bigint') return BigInt(v);
  if (Array.isArray(v)) return v.map(toMetadatum);
  if (v && typeof v === 'object') {
    return new Map(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toMetadatum(x)] as const));
  }
  throw new Error(`unsupported metadata value ${String(v)}`);
}

/** Mint the registry NFT for `seller`. Returns the tx hash and MASUMI agentIdentifier (policy ‖ assetName). */
export async function registerAgent(seller: NamedAccount, bf: BlockfrostConfig, listing: AgentListing) {
  const client = seller.signingClient(bf);
  const wallet = spendableWalletUtxos(await client.getWalletUtxos());
  const seed: UTxO.UTxO | undefined = wallet.find((u) => !Assets.hasMultiAsset(u.assets)) ?? wallet[0];
  if (!seed) throw new Error(`seller wallet ${seller.address} has no spendable UTxO; fund it with tADA`);
  const assetName = registryAssetName(TransactionHash.toHex(seed.transactionId), Number(seed.index));
  const nft = Assets.addByHex(Assets.zero, REGISTRY_POLICY_ID, assetName, 1n);
  const built = await client
    .newTx()
    .collectFrom({ inputs: [seed] })
    .attachScript({ script: registryScript() })
    .mintAssets({ assets: nft, redeemer: Data.constr(0n, []) })
    .payToAddress({ address: Address.fromBech32(seller.address), assets: Assets.withLovelace(nft, 2_000_000n), autoMinUtxo: true })
    .attachMetadata({ label: 721n, metadata: toMetadatum({ [REGISTRY_POLICY_ID]: { [assetName]: registryMetadata(listing) }, version: '1' }) })
    .addSigner({ keyHash: KeyHash.fromHex(seller.paymentKeyHash) })
    .build({ changeAddress: seller.ledgerAddress, availableUtxos: wallet });
  const txHash = TransactionHash.toHex(await (await built.sign()).submit());
  return { txHash, agentIdentifier: REGISTRY_POLICY_ID + assetName };
}
