//// Shared on-chain checks for the bloc validator.

use aiken/collection/dict
use aiken/collection/list
use bloc/types.{Asset, CampaignDatum}
use cardano/assets.{Assets, PolicyId}
use cardano/transaction.{InlineDatum, Input}

/// The campaign is the (unique) reference input holding the one-shot campaign
/// NFT of `campaign_policy`; its inline datum must parse and name the NFT.
/// Anything without the NFT (a "fake campaign") is never considered.
pub fn find_campaign(
  reference_inputs: List<Input>,
  campaign_policy: PolicyId,
) -> CampaignDatum {
  expect Some(input) = list.find(
    reference_inputs,
    fn(i) { assets.tokens(i.output.value, campaign_policy) != dict.empty },
  )
  expect [Pair(nft_name, 1)] = input.output.value
    |> assets.tokens(campaign_policy)
    |> dict.to_pairs
  expect InlineDatum(raw) = input.output.datum
  expect campaign: CampaignDatum = raw
  expect campaign.bloc_id == nft_name
  campaign
}

/// True when `value` carries no token of `policy` (pledges must never hold the
/// campaign NFT; the campaign UTxO locked at the script is unspendable).
pub fn holds_no(value: Assets, policy: PolicyId) -> Bool {
  assets.tokens(value, policy) == dict.empty
}

/// `out` holds at least everything in `locked`, except that `paid` units of
/// `asset` may be missing. Covers lovelace (min-ADA), the asset and any other
/// token the pledge happened to carry.
pub fn covers(out: Assets, locked: Assets, asset: Asset, paid: Int) -> Bool {
  assets.reduce(
    locked,
    True,
    fn(policy, name, qty, ok) {
      let needed = if policy == asset.policy && name == asset.name {
        qty - paid
      } else {
        qty
      }
      ok && assets.quantity_of(out, policy, name) >= needed
    },
  )
}
