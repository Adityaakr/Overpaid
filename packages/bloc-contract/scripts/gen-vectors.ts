// Prints the cross-language test vectors hardcoded in contracts/bloc/validators/bloc_test.ak
// (and stored in test/bid-vectors.json): ed25519 bid messages/signatures and Data CBOR.
//   pnpm --filter @overpaid/bloc-contract vectors > test/bid-vectors.json
import { Bytes } from "@evolution-sdk/evolution";
import {
  bidMessage,
  campaignDatumData,
  outRefData,
  pledgeDatumData,
  refundSpendRedeemer,
  settleRedeemerData,
  settleSpendRedeemer,
  signBid,
  toAikenCbor as cbor,
} from "../src/index.js";
import { BID1, BID2, BID3, CAMPAIGN, CAMPAIGN_POLICY, ITEM_HASH, PLEDGE0, PLEDGE_REF0, SK1, SK2, VK1, VK2 } from "../test/fixtures.js";

export function vectors() {
  const sig1 = signBid(SK1, CAMPAIGN_POLICY, BID1);
  return {
    item_hash: ITEM_HASH,
    vk1: VK1,
    vk2: VK2,
    msg1: Bytes.toHex(bidMessage(CAMPAIGN_POLICY, BID1)),
    sig1,
    msg2: Bytes.toHex(bidMessage(CAMPAIGN_POLICY, BID2)),
    sig2: signBid(SK2, CAMPAIGN_POLICY, BID2),
    msg3: Bytes.toHex(bidMessage(CAMPAIGN_POLICY, BID3)),
    sig3: signBid(SK1, CAMPAIGN_POLICY, BID3),
    cbor_pledge0: cbor(pledgeDatumData(PLEDGE0)),
    cbor_campaign: cbor(campaignDatumData(CAMPAIGN)),
    cbor_settle_redeemer: cbor(settleRedeemerData({ bid: BID1, signature: sig1, pairs: [[1, 1]] })),
    cbor_spend_settle: cbor(settleSpendRedeemer(3, 0)),
    cbor_spend_refund: cbor(refundSpendRedeemer(3, 2)),
    cbor_outref0: cbor(outRefData(PLEDGE_REF0)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(vectors(), null, 2));
