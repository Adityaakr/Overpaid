//// The bloc validator: ONE script, so `spend`, `withdraw` and `publish` share a
//// single hash and no handler needs another's hash as a parameter (no hash
//// cycle). Parameterised by the campaign policy id: each campaign gets its own
//// script, address and stake credential, and the campaign reference input can
//// be authenticated by that policy.
////
//// - spend   Settle: O(1) per pledge, requires our own withdraw-zero in the tx.
//// - spend   Refund: after refund_deadline, the whole pledge goes back.
//// - withdraw (settle): runs once, validates the bid and every pledge input.
//// - publish: only registration of our stake credential.

use aiken/collection/list
use aiken/interval
use bloc/checks.{covers, find_campaign, holds_no}
use bloc/message.{verify_bid}
use bloc/types.{PledgeDatum, PledgeRedeemer, Refund, Settle, SettleRedeemer}
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate, RegisterCredential}
use cardano/transaction.{InlineDatum, Input, OutputReference, Transaction}
use vendor/design_patterns.{one_to_one_fold, validate_withdraw_minimal}

validator bloc(campaign_policy: PolicyId) {
  spend(
    datum: Option<Data>,
    redeemer: PledgeRedeemer,
    own_ref: OutputReference,
    tx: Transaction,
  ) {
    when redeemer is {
      Settle { input_index, withdrawal_index } -> {
        let own = own_input(tx.inputs, input_index, own_ref)
        expect Script(own_hash) = own.output.address.payment_credential
        and {
          holds_no(own.output.value, campaign_policy),
          validate_withdraw_minimal(own_hash, tx.withdrawals, withdrawal_index),
        }
      }
      Refund { input_index, output_index } -> {
        expect Some(raw) = datum
        expect pledge: PledgeDatum = raw
        let own = own_input(tx.inputs, input_index, own_ref)
        let campaign = find_campaign(tx.reference_inputs, campaign_policy)
        expect Some(out) = list.at(tx.outputs, output_index)
        let own_ref_data: Data = own_ref
        and {
          holds_no(own.output.value, campaign_policy),
          interval.is_entirely_after(
            tx.validity_range,
            campaign.refund_deadline,
          ),
          out.address == pledge.member_refund_address,
          out.datum == InlineDatum(own_ref_data),
          covers(out.value, own.output.value, campaign.asset, 0),
        }
      }
    }
  }

  withdraw(redeemer: SettleRedeemer, account: Credential, tx: Transaction) {
    expect Script(own_hash) = account
    let SettleRedeemer { bid, signature, pairs } = redeemer
    let campaign = find_campaign(tx.reference_inputs, campaign_policy)
    let asset = campaign.asset
    let unit_price = bid.unit_price
    // -- the bid: for this campaign, allowlisted, signed, unexpired
    expect and {
        bid.bloc_id == campaign.bloc_id,
        bid.item_hash == campaign.item_hash,
        bid.asset == asset,
        unit_price > 0,
        list.has(campaign.provider_vkeys, bid.provider_vkey),
        verify_bid(campaign_policy, bid, signature),
        interval.is_entirely_before(
          tx.validity_range,
          if bid.expiry < campaign.bid_deadline {
            bid.expiry
          } else {
            campaign.bid_deadline
          },
        ),
      }
    // -- every script input is a funded pledge of this bloc, paired 1:1 with
    //    its refund output (outputs >= 1; output #0 is the provider's)
    let total_quantity = one_to_one_fold(
      pairs,
      own_hash,
      tx.inputs,
      tx.outputs,
      1,
      0,
      fn(_in_ix, input, _out_ix, out, acc) {
        let locked = input.output.value
        expect InlineDatum(raw) = input.output.datum
        expect pledge: PledgeDatum = raw
        let paid = unit_price * pledge.quantity
        let own_ref_data: Data = input.output_reference
        expect and {
            pledge.bloc_id == campaign.bloc_id,
            pledge.quantity > 0,
            pledge.max_unit_price >= unit_price,
            assets.quantity_of(locked, asset.policy, asset.name) >= pledge.max_unit_price * pledge.quantity,
            out.address == pledge.member_refund_address,
            out.datum == InlineDatum(own_ref_data),
            covers(out.value, locked, asset, paid),
          }
        acc + pledge.quantity
      },
    )
    // -- batch size and provider payment at output #0
    expect Some(provider_out) = list.head(tx.outputs)
    let tag: Data = campaign_policy
    and {
      list.length(pairs) >= campaign.min_batch,
      provider_out.address == bid.provider_address,
      provider_out.datum == InlineDatum(tag),
      assets.quantity_of(provider_out.value, asset.policy, asset.name) >= unit_price * total_quantity,
    }
  }

  publish(_redeemer: Data, certificate: Certificate, _tx: Transaction) {
    // The ledger only runs this script for certificates on our own credential.
    // Allow registering it (Conway RegCert, needed for withdraw-zero) and
    // nothing else: no deregistration (would let anyone pocket the deposit and
    // brick settlement until re-registered), no delegation.
    when certificate is {
      RegisterCredential { .. } -> True
      _ -> False
    }
  }

  else(_) {
    fail
  }
}

fn own_input(
  inputs: List<Input>,
  input_index: Int,
  own_ref: OutputReference,
) -> Input {
  expect Some(input) = list.at(inputs, input_index)
  expect input.output_reference == own_ref
  input
}
