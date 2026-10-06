/**
 * JSON wire format shared by services/bloc and services/providers (bigints as decimal strings, addresses as bech32).
 */
import { plutusAddressFromBech32, plutusAddressToBech32, type Bid, type Hex } from '@overpaid/bloc-contract';

export interface WireBid {
  blocId: Hex;
  itemHash: Hex;
  asset: { policy: Hex; name: Hex };
  unitPrice: string; // lovelace
  expiry: string; // POSIX ms
  providerVkey: Hex;
  providerAddress: string; // bech32 (base or enterprise)
}

export interface BidSubmission {
  provider: string;
  strategy?: string;
  simulated?: boolean;
  bid: WireBid;
  signature: Hex;
}

const HEX = /^[0-9a-fA-F]*$/;
const UINT = /^\d{1,20}$/;

export function bidFromWire(w: WireBid): Bid {
  for (const [k, v] of [['blocId', w.blocId], ['itemHash', w.itemHash], ['asset.policy', w.asset?.policy], ['asset.name', w.asset?.name], ['providerVkey', w.providerVkey]] as const) {
    if (typeof v !== 'string' || !HEX.test(v) || v.length % 2) throw new Error(`${k}: expected hex`);
  }
  if (!UINT.test(String(w.unitPrice))) throw new Error('unitPrice: expected a decimal lovelace string');
  if (!UINT.test(String(w.expiry))) throw new Error('expiry: expected POSIX ms as a decimal string');
  if (typeof w.providerAddress !== 'string') throw new Error('providerAddress: expected bech32');
  return {
    blocId: w.blocId.toLowerCase(),
    itemHash: w.itemHash.toLowerCase(),
    asset: { policy: w.asset.policy.toLowerCase(), name: w.asset.name.toLowerCase() },
    unitPrice: BigInt(w.unitPrice),
    expiry: BigInt(w.expiry),
    providerVkey: w.providerVkey.toLowerCase(),
    providerAddress: plutusAddressFromBech32(w.providerAddress),
  };
}

export function bidToWire(b: Bid, networkId = 0): WireBid {
  return {
    blocId: b.blocId,
    itemHash: b.itemHash,
    asset: { ...b.asset },
    unitPrice: b.unitPrice.toString(),
    expiry: b.expiry.toString(),
    providerVkey: b.providerVkey,
    providerAddress: plutusAddressToBech32(b.providerAddress, networkId),
  };
}

/** Public campaign fields providers need to build a bid (part of GET /state -> campaign.bidTerms). */
export interface BidTerms {
  policyId: Hex;
  blocId: Hex;
  itemHash: Hex;
  asset: { policy: Hex; name: Hex };
  bidDeadline: number;
  providerVkeys: Hex[];
}
