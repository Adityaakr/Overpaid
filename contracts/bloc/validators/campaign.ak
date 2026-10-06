//// One-shot campaign NFT. Parameterised by a seed UTxO that the minting
//// transaction must spend, so at most one token can ever exist per policy.
//// Its asset name is the campaign's `bloc_id`.

use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use bloc/types.{CampaignDatum}
use cardano/assets.{PolicyId}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

validator campaign(seed: OutputReference) {
  mint(_redeemer: Data, policy_id: PolicyId, tx: Transaction) {
    when tx.mint |> assets.tokens(policy_id) |> dict.to_pairs is {
      [Pair(bloc_id, 1)] -> {
        // one-shot: the seed must be consumed by this very transaction
        expect list.any(tx.inputs, fn(input) { input.output_reference == seed })
        // the output receiving the NFT carries a well-formed campaign datum
        expect Some(out) = list.find(
          tx.outputs,
          fn(o) { assets.quantity_of(o.value, policy_id, bloc_id) == 1 },
        )
        expect InlineDatum(raw) = out.datum
        expect c: CampaignDatum = raw
        and {
          c.bloc_id == bloc_id,
          bytearray.length(bloc_id) <= 32,
          c.min_batch >= 1,
          c.members_limit >= c.min_batch,
          c.bid_deadline < c.refund_deadline,
          or {
            c.asset.policy != "",
            c.asset.name == "",
          },
          c.provider_vkeys != [],
          list.all(c.provider_vkeys, fn(vk) { bytearray.length(vk) == 32 }),
        }
      }
      // burning the NFT is always allowed (but see README: a campaign locked at
      // the bloc address can never be burned, which keeps refunds possible)
      [Pair(_, -1)] -> True
      _ -> False
    }
  }

  else(_) {
    fail
  }
}
