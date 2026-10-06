// Offline fixtures: a real applied campaign policy / bloc script (from the example seed in apply-params.md),
// synthetic key-hash addresses and ed25519 provider keys. No network, no mnemonics.
import { createHash } from 'node:crypto';
import { Address, Assets, InlineDatum, TransactionHash, UTxO } from '@evolution-sdk/evolution';
import {
  blocAddress, blocScript, campaignDatumData, campaignPolicy, pledgeDatumData, plutusAddressToBech32, signBid, vkeyFromSecret,
  type Bid, type CampaignDatum, type PlutusAddress,
} from '@overpaid/bloc-contract';
import type { CampaignInfo } from '../src/planner.js';

export const hexOf = (s: string) => Buffer.from(s, 'utf8').toString('hex');
export const txHash = (n: number) => createHash('sha256').update(`tx-${n}`).digest('hex');

export const SEED = { txHash: '5e'.repeat(32), index: 1 };
export const POLICY = campaignPolicy(SEED);
export const BLOC = blocScript(POLICY.hash);
export const BLOC_ADDRESS = blocAddress(BLOC.hash, 0);

export const SK = [1, 2, 3, 4].map((n) => new Uint8Array(32).fill(n));
export const VK = SK.map(vkeyFromSecret);
export const BLOC_ID = hexOf('esim-eu-30d');
export const ITEM_HASH = createHash('sha256').update('eSIM Europe 30-day 10GB').digest('hex');
export const ADA = { policy: '', name: '' };
export const NOW = 1_790_000_000_000n;

export const CAMPAIGN_DATUM: CampaignDatum = {
  blocId: BLOC_ID, itemHash: ITEM_HASH, asset: ADA, membersLimit: 150n, minBatch: 1n,
  bidDeadline: NOW + 3_600_000n, refundDeadline: NOW + 7_200_000n, providerVkeys: VK.slice(0, 3),
};
export const CAMPAIGN: CampaignInfo = { policyId: POLICY.hash, ...CAMPAIGN_DATUM };

export const keyAddr = (n: number): PlutusAddress => ({
  payment: { type: 'key', hash: n.toString(16).padStart(56, '0') },
  stake: { type: 'key', hash: (n + 7).toString(16).padStart(56, 'e') },
});
export const bech = (a: PlutusAddress) => plutusAddressToBech32(a, 0);
export const ADMIN = bech(keyAddr(9_999));
export const PROVIDER_ADDR = keyAddr(8_888);

export function bidFor(i: number, unitPrice: bigint, over: Partial<Bid> = {}): { bid: Bid; signature: string } {
  const bid: Bid = { blocId: BLOC_ID, itemHash: ITEM_HASH, asset: ADA, unitPrice, expiry: NOW + 1_800_000n, providerVkey: VK[i]!, providerAddress: PROVIDER_ADDR, ...over };
  return { bid, signature: signBid(SK[i]!, POLICY.hash, bid) };
}

export function campaignUtxo(): UTxO.UTxO {
  return new UTxO.UTxO({
    transactionId: TransactionHash.fromHex(txHash(0)), index: 0n, address: Address.fromBech32(BLOC_ADDRESS),
    assets: Assets.fromHexStrings(POLICY.hash, BLOC_ID, 1n, 2_000_000n), datumOption: new InlineDatum.InlineDatum({ data: campaignDatumData(CAMPAIGN_DATUM) }),
  });
}

export function pledgeUtxo(n: number, lovelace = 4_500_000n, maxUnitPrice = 3_000_000n, blocId = BLOC_ID): UTxO.UTxO {
  return new UTxO.UTxO({
    transactionId: TransactionHash.fromHex(txHash(1000 + n)), index: BigInt(n % 3), address: Address.fromBech32(BLOC_ADDRESS),
    assets: Assets.fromLovelace(lovelace),
    datumOption: new InlineDatum.InlineDatum({ data: pledgeDatumData({ blocId, memberRefundAddress: keyAddr(n + 1), quantity: 1n, maxUnitPrice }) }),
  });
}

export function walletUtxo(n: number, lovelace: bigint, address = ADMIN): UTxO.UTxO {
  return new UTxO.UTxO({ transactionId: TransactionHash.fromHex(txHash(50_000 + n)), index: 0n, address: Address.fromBech32(address), assets: Assets.fromLovelace(lovelace) });
}
