// Shared fixtures: the same constants are hardcoded in contracts/bloc/validators/bloc_test.ak.
import { createHash } from "node:crypto";
import { vkeyFromSecret, type Bid } from "../src/index.js";

const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

export const CAMPAIGN_POLICY = "c0".repeat(28);
export const BLOC_ID = hex("esim-eu-30d");
export const ITEM_HASH = createHash("sha256").update("eSIM Europe 30-day 10GB").digest("hex");
export const ASSET = { policy: "a5".repeat(28), name: hex("USDM") };
export const UNIT_PRICE = 4_000_000n;
export const EXPIRY = 1_800_000_000_000n;

export const SK1 = new Uint8Array(32).fill(1); // allowlisted provider
export const SK2 = new Uint8Array(32).fill(2); // NOT allowlisted
export const VK1 = vkeyFromSecret(SK1);
export const VK2 = vkeyFromSecret(SK2);

export const PROVIDER_ADDRESS = { payment: { type: "key" as const, hash: "b1".repeat(28) }, stake: { type: "key" as const, hash: "b2".repeat(28) } };

export const BID1: Bid = { blocId: BLOC_ID, itemHash: ITEM_HASH, asset: ASSET, unitPrice: UNIT_PRICE, expiry: EXPIRY, providerVkey: VK1, providerAddress: PROVIDER_ADDRESS };
export const BID2: Bid = { ...BID1, providerVkey: VK2 };
export const BID3: Bid = { ...BID1, providerAddress: { payment: { type: "script", hash: "b3".repeat(28) } } };

export const BID_DEADLINE = 1_790_000_000_000n;
export const REFUND_DEADLINE = 1_795_000_000_000n;
export const MEMBER0 = { payment: { type: "key" as const, hash: "00".repeat(27) + "01" }, stake: { type: "key" as const, hash: "e1".repeat(28) } };
export const PLEDGE0 = { blocId: BLOC_ID, memberRefundAddress: MEMBER0, quantity: 2n, maxUnitPrice: 5_000_000n };
export const CAMPAIGN = {
  blocId: BLOC_ID,
  itemHash: ITEM_HASH,
  asset: ASSET,
  membersLimit: 150n,
  minBatch: 1n,
  bidDeadline: BID_DEADLINE,
  refundDeadline: REFUND_DEADLINE,
  providerVkeys: ["aa".repeat(32), VK1],
};
export const PLEDGE_REF0 = { txHash: "77".repeat(32), index: 0 };
