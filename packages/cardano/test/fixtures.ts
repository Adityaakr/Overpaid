/**
 * Offline fixtures: a real seller-signed Masumi quote (x402's own issuer + signer), a lock built with x402's own
 * buildMasumiLock, and Evolution UTxO objects at the escrow / in wallets. Mnemonics are public BIP-39 test vectors
 * (never funded). No network access.
 */
import { Address, Assets, Data, InlineDatum, TransactionHash, UTxO } from '@evolution-sdk/evolution';
import { addressFromSeed } from '@evolution-sdk/evolution/sdk/wallet/Derivation';
import type * as Provider from '@evolution-sdk/evolution/sdk/provider/Provider';
import { buildMasumiLock, issueMasumiRequirements, toMasumiSellerSigner, type CardanoExtraMasumi } from '@x402/cardano';
import { ESCROW_ADDRESS, NETWORK } from '../src/constants.js';

export const SELLER_MNEMONIC = `${'abandon '.repeat(23)}art`;
export const BUYER_MNEMONIC = `${'zoo '.repeat(23)}vote`;

export const sellerAddr = Address.toBech32(addressFromSeed(SELLER_MNEMONIC, { networkId: 0, accountIndex: 1 }).address);
export const buyerAddr = Address.toBech32(addressFromSeed(BUYER_MNEMONIC, { networkId: 0, accountIndex: 0 }).address);
export const vkhOf = (bech32: string) => {
  const a = Address.fromBech32(bech32);
  return Buffer.from((a.paymentCredential as { hash: Uint8Array }).hash).toString('hex');
};

/** Fixture "now": the next whole minute plus one hour (the issuer checks deadlines against the real clock). */
export const T0 = BigInt(Math.ceil(Date.now() / 60_000) * 60_000) + 3_600_000n;
export const PRICE = 5_000_000n;
export const COINS_PER_UTXO_BYTE = 4310n;

export async function signedQuote(task: unknown = { merchant: 'skylane', booking_ref: 'SKX7Q2' }, price: bigint = PRICE) {
  const seller = toMasumiSellerSigner({ mnemonic: SELLER_MNEMONIC, network: NETWORK, accountIndex: 1 });
  const payBy = T0 + 300_000n;
  const reqs = await issueMasumiRequirements({
    network: NETWORK, asset: 'lovelace', amount: price.toString(), maxTimeoutSeconds: 7200, // payBy = T0+5min must be <= real now + maxTimeout
    sellerAddress: seller.sellerAddress, signTerms: seller.signTerms,
    commitment: [{ name: 'body', canonicalization: 'jcs', mediaType: 'application/json', content: task }],
    payByTime: payBy.toString(),
    submitResultTime: (payBy + 15n * 60_000n).toString(),
    unlockTime: (payBy + 35n * 60_000n).toString(),
    externalDisputeUnlockTime: (payBy + 55n * 60_000n).toString(),
  });
  return { reqs, extra: reqs.extra as unknown as CardanoExtraMasumi, seller };
}

export async function lockFixture(price: bigint = PRICE) {
  const { extra, reqs } = await signedQuote(undefined, price);
  const lock = buildMasumiLock(extra, buyerAddr, 'lovelace', price, COINS_PER_UTXO_BYTE);
  return { extra, reqs, lock };
}

export const txHash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

export function escrowUtxo(datum: Data.Data, lovelace: bigint, n = 1, index = 0n): UTxO.UTxO {
  return new UTxO.UTxO({
    transactionId: TransactionHash.fromHex(txHash(n)),
    index,
    address: Address.fromBech32(ESCROW_ADDRESS),
    assets: Assets.fromLovelace(lovelace),
    datumOption: new InlineDatum.InlineDatum({ data: datum }),
  });
}

export function walletUtxo(address: string, lovelace: bigint, n: number, index = 0n): UTxO.UTxO {
  return new UTxO.UTxO({ transactionId: TransactionHash.fromHex(txHash(n)), index, address: Address.fromBech32(address), assets: Assets.fromLovelace(lovelace) });
}

const costModel = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 1000 + i]));
/** Shape-correct preprod-like protocol parameters (Conway values for fees/limits; dummy cost-model numbers). */
export const PROTOCOL_PARAMS: Provider.ProtocolParameters = {
  minFeeA: 44, minFeeB: 155381, maxTxSize: 16384, maxValSize: 5000,
  keyDeposit: 2_000_000n, poolDeposit: 500_000_000n, drepDeposit: 500_000_000n, govActionDeposit: 100_000_000_000n,
  priceMem: 0.0577, priceStep: 0.0000721, maxTxExMem: 14_000_000n, maxTxExSteps: 10_000_000_000n,
  coinsPerUtxoByte: COINS_PER_UTXO_BYTE, collateralPercentage: 150, maxCollateralInputs: 3, minFeeRefScriptCostPerByte: 15,
  costModels: { PlutusV1: costModel(166), PlutusV2: costModel(175), PlutusV3: costModel(297) },
};
