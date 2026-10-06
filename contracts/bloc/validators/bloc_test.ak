//// Tests for the bloc validator (validators/bloc.ak), the campaign policy
//// (validators/campaign.ak) and the bid message layout (lib/bloc/message.ak).
////
//// Transactions are built from `transaction.placeholder`. The handlers are called
//// directly, so `fail` tests pass when the handler returns False OR halts.
//// The ed25519 vectors were produced by packages/bloc-contract (Node,
//// @noble/curves) over the documented layout: `pnpm --filter
//// @overpaid/bloc-contract vectors`.

use aiken/cbor
use aiken/collection/list
use aiken/fuzz
use aiken/interval.{Finite, Interval, IntervalBound}
use aiken/primitive/bytearray
use bloc
use bloc/message.{bid_message, verify_bid}
use bloc/types.{
  Asset, Bid, CampaignDatum, PledgeDatum, Refund, Settle, SettleRedeemer,
}
use campaign
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets
use cardano/certificate.{RegisterCredential, UnregisterCredential}
use cardano/transaction.{
  InlineDatum, Input, NoDatum, Output, OutputReference, Transaction, placeholder,
}

// ---------------------------------------------------------------------------
// Fixtures (mirrored in packages/bloc-contract/test/fixtures.ts)
// ---------------------------------------------------------------------------

const campaign_policy: ByteArray =
  #"c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

/// Hash of the (applied) bloc script, arbitrary in unit tests.
const own_hash: ByteArray =
  #"5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c"

const bloc_id: ByteArray = "esim-eu-30d"

const item_hash: ByteArray =
  #"ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4dd"

const usdm_policy: ByteArray =
  #"a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5"

const usdm_name: ByteArray = "USDM"

const unit_price: Int = 4_000_000

const max_price: Int = 5_000_000

const expiry: Int = 1_800_000_000_000

const bid_deadline: Int = 1_790_000_000_000

const refund_deadline: Int = 1_795_000_000_000

const vk1: ByteArray =
  #"8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"

const vk2: ByteArray =
  #"8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394"

const sig1: ByteArray =
  #"6d6bd112a0e4269234fd1eb8436348aa8ef158be43e4ccc448185b83345b19da30cc690d9c2be068b5fbc1300d7b2c0b1c4f972d013ff16d35ff13f66081dc05"

const sig2: ByteArray =
  #"817ff2db341c4df2255a75ada1446e20d1b48eafe83e823eb65d2ce0a871af2a5d7105dacc45f8c685ddff88364a0b0592afbe292e3975e7a7edb48db689220f"

const sig3: ByteArray =
  #"1fd1e4b73610147340cb6f7fbb67a9f4abf5338ec09b4a25745ceea2761573bd61d66f58cd54a6e1f1dfb8524ae3b63a2383787fc863f94d8d4f10fc7db2cf02"

const msg1: ByteArray =
  #"424c4f4342494431c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c00b6573696d2d65752d33306420ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4dd1ca5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5045553444d00000000003d0900000001a3185c50008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c00b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b101b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"

const msg3: ByteArray =
  #"424c4f4342494431c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c00b6573696d2d65752d33306420ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4dd1ca5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5045553444d00000000003d0900000001a3185c50008a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c01b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b300"

fn asset() -> Asset {
  Asset { policy: usdm_policy, name: usdm_name }
}

fn provider_address() -> Address {
  Address {
    payment_credential: VerificationKey(
      #"b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
    ),
    stake_credential: Some(
      Inline(
        VerificationKey(
          #"b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
        ),
      ),
    ),
  }
}

fn script_address() -> Address {
  Address { payment_credential: Script(own_hash), stake_credential: None }
}

fn bid1() -> Bid {
  Bid {
    bloc_id,
    item_hash,
    asset: asset(),
    unit_price,
    expiry,
    provider_vkey: vk1,
    provider_address: provider_address(),
  }
}

fn bid2() -> Bid {
  Bid { ..bid1(), provider_vkey: vk2 }
}

fn bid3() -> Bid {
  Bid {
    ..bid1(),
    provider_address: Address {
      payment_credential: Script(
        #"b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3",
      ),
      stake_credential: None,
    },
  }
}

fn campaign_datum() -> CampaignDatum {
  CampaignDatum {
    bloc_id,
    item_hash,
    asset: asset(),
    members_limit: 150,
    min_batch: 1,
    bid_deadline,
    refund_deadline,
    provider_vkeys: [
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", vk1,
    ],
  }
}

/// The campaign UTxO, locked at the bloc script address, used as reference input.
fn campaign_input(datum: CampaignDatum, policy: ByteArray) -> Input {
  let d: Data = datum
  Input {
    output_reference: OutputReference {
      transaction_id: #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      output_index: 0,
    },
    output: Output {
      address: script_address(),
      value: assets.from_lovelace(3_000_000)
        |> assets.add(policy, datum.bloc_id, 1),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
}

fn fee_input() -> Input {
  Input {
    output_reference: OutputReference {
      transaction_id: #"0000000000000000000000000000000000000000000000000000000000000000",
      output_index: 0,
    },
    output: Output {
      address: address.from_verification_key(
        #"efefefefefefefefefefefefefefefefefefefefefefefefefefefef",
      ),
      value: assets.from_lovelace(50_000_000),
      datum: NoDatum,
      reference_script: None,
    },
  }
}

fn change_output() -> Output {
  Output { ..fee_input().output, value: assets.from_lovelace(45_000_000) }
}

/// Ledger-like validity range: lower bound inclusive, upper bound exclusive.
fn range(lo: Int, hi: Int) -> Interval {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(lo), is_inclusive: True },
    upper_bound: IntervalBound { bound_type: Finite(hi), is_inclusive: False },
  }
}

// ---------------------------------------------------------------------------
// Pledges and settlement builder
// ---------------------------------------------------------------------------

type P {
  quantity: Int,
  max: Int,
  extra: Int,
  lovelace: Int,
  bloc: ByteArray,
}

fn p(quantity: Int) -> P {
  P { quantity, max: max_price, extra: 0, lovelace: 1_500_000, bloc: bloc_id }
}

fn member(i: Int) -> Address {
  Address {
    payment_credential: VerificationKey(
      bytearray.from_int_big_endian(i + 1, 28),
    ),
    stake_credential: Some(
      Inline(
        VerificationKey(
          #"e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1",
        ),
      ),
    ),
  }
}

fn pledge_ref(i: Int) -> OutputReference {
  OutputReference {
    transaction_id: #"7777777777777777777777777777777777777777777777777777777777777777",
    output_index: i,
  }
}

fn locked(x: P) -> Int {
  x.max * x.quantity + x.extra
}

fn pledge_datum(i: Int, x: P) -> PledgeDatum {
  PledgeDatum {
    bloc_id: x.bloc,
    member_refund_address: member(i),
    quantity: x.quantity,
    max_unit_price: x.max,
  }
}

fn pledge_input(i: Int, x: P) -> Input {
  let d: Data = pledge_datum(i, x)
  Input {
    output_reference: pledge_ref(i),
    output: Output {
      address: script_address(),
      value: assets.from_lovelace(x.lovelace)
        |> assets.add(usdm_policy, usdm_name, locked(x)),
      datum: InlineDatum(d),
      reference_script: None,
    },
  }
}

fn refund_output(i: Int, x: P, paid_per_unit: Int) -> Output {
  let d: Data = pledge_ref(i)
  Output {
    address: member(i),
    value: assets.from_lovelace(x.lovelace)
      |> assets.add(
          usdm_policy,
          usdm_name,
          locked(x) - paid_per_unit * x.quantity,
        ),
    datum: InlineDatum(d),
    reference_script: None,
  }
}

fn provider_output(amount: Int) -> Output {
  let tag: Data = campaign_policy
  Output {
    address: provider_address(),
    value: assets.from_lovelace(2_000_000)
      |> assets.add(usdm_policy, usdm_name, amount),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

type Settlement {
  tx: Transaction,
  redeemer: SettleRedeemer,
}

fn total_quantity(ps: List<P>) -> Int {
  list.foldl(ps, 0, fn(x, acc) { acc + x.quantity })
}

/// Inputs: [fee, pledge 0..n-1]  -> pledge i at input index i + 1
/// Outputs: [provider, refund 0..n-1, change] -> refund i at output index i + 1
fn settlement(ps: List<P>) -> Settlement {
  let n = list.length(ps)
  let tx = Transaction {
    ..placeholder,
    inputs: [fee_input(), ..list.indexed_map(ps, pledge_input)],
    reference_inputs: [campaign_input(campaign_datum(), campaign_policy)],
    outputs: [
      provider_output(unit_price * total_quantity(ps)),
      ..list.indexed_map(ps, fn(i, x) { refund_output(i, x, unit_price) })
    ]
      |> list.concat([change_output()]),
    withdrawals: [Pair(Script(own_hash), 0)],
    validity_range: range(1_780_000_000_000, 1_785_000_000_000),
  }
  let pairs = if n == 0 {
    []
  } else {
    list.map(list.range(1, n), fn(k) { Pair(k, k) })
  }
  Settlement {
    tx,
    redeemer: SettleRedeemer { bid: bid1(), signature: sig1, pairs },
  }
}

fn with_tx(s: Settlement, tx: Transaction) -> Settlement {
  Settlement { ..s, tx }
}

fn with_outputs(s: Settlement, outputs: List<Output>) -> Settlement {
  with_tx(s, Transaction { ..s.tx, outputs })
}

fn set_at(xs: List<a>, ix: Int, x: a) -> List<a> {
  list.indexed_map(
    xs,
    fn(i, y) {
      if i == ix {
        x
      } else {
        y
      }
    },
  )
}

/// Run the withdraw (settle) handler.
fn settles(s: Settlement) -> Bool {
  bloc.bloc.withdraw(campaign_policy, s.redeemer, Script(own_hash), s.tx)
}

/// Run the spend handler (Settle) for every script input.
fn spends_all(s: Settlement) -> Bool {
  list.indexed_map(s.tx.inputs, fn(i, input) { (i, input) })
    |> list.all(
        fn(t) {
          let (i, input) = t
          if input.output.address == script_address() {
            expect InlineDatum(d) = input.output.datum
            bloc.bloc.spend(
              campaign_policy,
              Some(d),
              Settle { input_index: i, withdrawal_index: 0 },
              input.output_reference,
              s.tx,
            )
          } else {
            True
          }
        },
      )
}

fn three() -> List<P> {
  [p(1), p(2), p(3)]
}

// ---------------------------------------------------------------------------
// 1. A valid settlement passes
// ---------------------------------------------------------------------------

test t01_valid_settlement_passes() {
  let s = settlement(three())
  settles(s) && spends_all(s)
}

fn pledge_fuzzer() -> Fuzzer<P> {
  let quantity <- fuzz.and_then(fuzz.int_between(1, 5))
  let max <- fuzz.and_then(fuzz.int_between(unit_price, 3 * unit_price))
  let extra <- fuzz.and_then(fuzz.int_between(0, 2_000_000))
  let lovelace <- fuzz.map(fuzz.int_between(1_100_000, 3_000_000))
  P { quantity, max, extra, lovelace, bloc: bloc_id }
}

test t01_prop_valid_settlement_passes(
  ps via fuzz.list_between(pledge_fuzzer(), 1, 8),
) {
  let s = settlement(ps)
  settles(s) && spends_all(s)
}

test t01_member_may_receive_more() {
  let s = settlement(three())
  let bigger = Output {
    ..refund_output(0, p(1), unit_price),
    value: assets.from_lovelace(9_000_000)
      |> assets.add(usdm_policy, usdm_name, 7_000_000),
  }
  settles(with_outputs(s, set_at(s.tx.outputs, 1, bigger)))
}

test t01_min_batch_respected() fail {
  let s = settlement([p(1), p(1)])
  let c = CampaignDatum { ..campaign_datum(), min_batch: 3 }
  settles(
    with_tx(
      s,
      Transaction {
        ..s.tx,
        reference_inputs: [campaign_input(c, campaign_policy)],
      },
    ),
  )
}

// ---------------------------------------------------------------------------
// 2. An underpaid provider fails
// ---------------------------------------------------------------------------

test t02_underpaid_provider_fails() fail {
  let s = settlement(three())
  let short = provider_output(unit_price * 6 - 1)
  settles(with_outputs(s, set_at(s.tx.outputs, 0, short)))
}

test t02_prop_underpaid_provider_fails(
  t via fuzz.both(
    fuzz.list_between(pledge_fuzzer(), 1, 6),
    fuzz.int_between(1, 4_000_000),
  ),
) fail {
  let (ps, shortfall) = t
  let s = settlement(ps)
  let short = provider_output(unit_price * total_quantity(ps) - shortfall)
  settles(with_outputs(s, set_at(s.tx.outputs, 0, short)))
}

test t02_provider_wrong_address_fails() fail {
  let s = settlement(three())
  let wrong = Output { ..provider_output(unit_price * 6), address: member(9) }
  settles(with_outputs(s, set_at(s.tx.outputs, 0, wrong)))
}

test t02_provider_output_without_campaign_tag_fails() fail {
  let s = settlement(three())
  let untagged = Output { ..provider_output(unit_price * 6), datum: NoDatum }
  settles(with_outputs(s, set_at(s.tx.outputs, 0, untagged)))
}

// ---------------------------------------------------------------------------
// 3. A missing or short refund fails
// ---------------------------------------------------------------------------

test t03_missing_refund_fails() fail {
  // drop the last refund (and change): pair (3, 3) points past the outputs
  let s = settlement(three())
  settles(with_outputs(s, list.take(s.tx.outputs, 3)))
}

test t03_short_refund_fails() fail {
  let s = settlement(three())
  let short = refund_output(1, p(2), unit_price + 1)
  settles(with_outputs(s, set_at(s.tx.outputs, 2, short)))
}

test t03_prop_short_refund_fails(
  t via fuzz.both(
    fuzz.list_between(pledge_fuzzer(), 1, 6),
    fuzz.int_between(1, 1_000_000),
  ),
) fail {
  let (ps, shortfall) = t
  let s = settlement(ps)
  expect Some(x) = list.head(ps)
  let r = refund_output(0, x, unit_price)
  let short = Output {
    ..r,
    value: assets.add(r.value, usdm_policy, usdm_name, -shortfall),
  }
  settles(with_outputs(s, set_at(s.tx.outputs, 1, short)))
}

test t03_refund_to_wrong_address_fails() fail {
  let s = settlement(three())
  let stolen = Output {
    ..refund_output(0, p(1), unit_price),
    address: member(42),
  }
  settles(with_outputs(s, set_at(s.tx.outputs, 1, stolen)))
}

test t03_refund_paired_with_provider_output_fails() fail {
  // pairs may never use output #0 (reserved for the provider)
  let s = settlement([p(1)])
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer { ..s.redeemer, pairs: [Pair(1, 0)] },
    },
  )
}

// ---------------------------------------------------------------------------
// 4. A refund that keeps the pledge's min-ADA fails
// ---------------------------------------------------------------------------

test t04_refund_keeping_min_ada_fails() fail {
  let s = settlement(three())
  let r = refund_output(0, p(1), unit_price)
  let no_ada = Output { ..r, value: assets.add(r.value, "", "", -1_500_000) }
  settles(with_outputs(s, set_at(s.tx.outputs, 1, no_ada)))
}

test t04_prop_refund_keeping_some_ada_fails(
  shortfall via fuzz.int_between(1, 1_500_000),
) fail {
  let s = settlement(three())
  let r = refund_output(0, p(1), unit_price)
  let less = Output { ..r, value: assets.add(r.value, "", "", -shortfall) }
  settles(with_outputs(s, set_at(s.tx.outputs, 1, less)))
}

// ---------------------------------------------------------------------------
// 5. Mixed bloc ids fail
// ---------------------------------------------------------------------------

test t05_mixed_bloc_ids_fail() fail {
  settles(settlement([p(1), P { ..p(2), bloc: "other-bloc" }, p(3)]))
}

test t05_bid_for_other_bloc_fails() fail {
  // even a correctly signed bid must name this campaign's bloc/item/asset
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer {
        ..s.redeemer,
        bid: Bid {
          ..bid1(),
          item_hash: #"0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    },
  )
}

// ---------------------------------------------------------------------------
// 6. A fake campaign without the NFT fails
// ---------------------------------------------------------------------------

test t06_campaign_without_nft_fails() fail {
  let s = settlement(three())
  let fake = campaign_input(campaign_datum(), campaign_policy)
  let no_nft = Input {
    ..fake,
    output: Output { ..fake.output, value: assets.from_lovelace(3_000_000) },
  }
  settles(with_tx(s, Transaction { ..s.tx, reference_inputs: [no_nft] }))
}

test t06_campaign_with_foreign_policy_nft_fails() fail {
  // attacker mints their own "campaign" NFT allowlisting their own key
  let s = settlement(three())
  let fake = campaign_input(
    campaign_datum(),
    #"d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0",
  )
  settles(with_tx(s, Transaction { ..s.tx, reference_inputs: [fake] }))
}

test t06_campaign_datum_must_name_nft() fail {
  let s = settlement(three())
  let c = campaign_input(campaign_datum(), campaign_policy)
  let mislabelled = Input {
    ..c,
    output: Output {
      ..c.output,
      value: assets.from_lovelace(3_000_000)
        |> assets.add(campaign_policy, "another", 1),
    },
  }
  settles(with_tx(s, Transaction { ..s.tx, reference_inputs: [mislabelled] }))
}

// ---------------------------------------------------------------------------
// 7. An unfunded pledge (datum says more than it holds) fails
// ---------------------------------------------------------------------------

test t07_unfunded_pledge_fails() fail {
  // datum promises max 5 USDM x 2 but only 9.999999 USDM is locked
  settles(settlement([p(1), P { ..p(2), extra: -1 }, p(3)]))
}

test t07_prop_unfunded_pledge_fails(
  missing via fuzz.int_between(1, 10_000_000),
) fail {
  settles(settlement([p(1), P { ..p(2), extra: -missing }]))
}

test t07_max_price_below_bid_fails() fail {
  settles(settlement([p(1), P { ..p(2), max: unit_price - 1, extra: 10 }]))
}

// ---------------------------------------------------------------------------
// 8. Double satisfaction (two pledges, one refund output) fails
// ---------------------------------------------------------------------------

test t08_two_pledges_one_output_fails() fail {
  // same member, both pairs point at the same output
  let ps = [p(1), p(1)]
  let s = settlement(ps)
  let same_member = Transaction {
    ..s.tx,
    inputs: [
      fee_input(),
      pledge_input(0, p(1)),
      Input {
        ..pledge_input(1, p(1)),
        output: Output {
          ..pledge_input(1, p(1)).output,
          datum: InlineDatum(pledge_datum(0, p(1))),
        },
      },
    ],
  }
  settles(
    Settlement {
      tx: same_member,
      redeemer: SettleRedeemer { ..s.redeemer, pairs: [Pair(1, 1), Pair(2, 1)] },
    },
  )
}

test t08_refund_output_naming_other_pledge_fails() fail {
  // two refund outputs, but the second is tagged with the first pledge's ref
  let s = settlement([p(1), p(1)])
  let r = refund_output(1, p(1), unit_price)
  let d: Data = pledge_ref(0)
  let mis_tagged = Output { ..r, datum: InlineDatum(d) }
  settles(with_outputs(s, set_at(s.tx.outputs, 2, mis_tagged)))
}

test t08_fewer_pairs_than_script_inputs_fails() fail {
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer { ..s.redeemer, pairs: [Pair(1, 1), Pair(2, 2)] },
    },
  )
}

test t08_non_increasing_pairs_fail() fail {
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer {
        ..s.redeemer,
        pairs: [Pair(1, 2), Pair(2, 1), Pair(3, 3)],
      },
    },
  )
}

test t08_extra_pairs_fail() fail {
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer {
        ..s.redeemer,
        pairs: [Pair(1, 1), Pair(2, 2), Pair(3, 3), Pair(4, 4)],
      },
    },
  )
}

// ---------------------------------------------------------------------------
// 9. An invalid, expired, or non-allowlisted bid fails
// ---------------------------------------------------------------------------

test t09_invalid_signature_fails() fail {
  let s = settlement(three())
  // signature of a different message (bid3) presented for bid1
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer { ..s.redeemer, signature: sig3 },
    },
  )
}

test t09_tampered_price_fails() fail {
  let ps = three()
  let s = settlement(ps)
  let cheaper = 3_000_000
  let tx = Transaction {
    ..s.tx,
    outputs: [
      provider_output(cheaper * total_quantity(ps)),
      ..list.indexed_map(ps, fn(i, x) { refund_output(i, x, cheaper) })
    ],
  }
  settles(
    Settlement {
      tx,
      redeemer: SettleRedeemer {
        ..s.redeemer,
        bid: Bid { ..bid1(), unit_price: cheaper },
      },
    },
  )
}

test t09_short_signature_fails() fail {
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer { ..s.redeemer, signature: #"00" },
    },
  )
}

test t09_expired_bid_fails() fail {
  let s = settlement(three())
  // bid deadline moved past the bid's own expiry, tx valid up to (not incl.) expiry + 1
  let c = CampaignDatum { ..campaign_datum(), bid_deadline: expiry + 10_000 }
  settles(
    with_tx(
      s,
      Transaction {
        ..s.tx,
        reference_inputs: [campaign_input(c, campaign_policy)],
        validity_range: range(expiry - 10_000, expiry + 1),
      },
    ),
  )
}

test t09_after_bid_deadline_fails() fail {
  let s = settlement(three())
  settles(
    with_tx(
      s,
      Transaction {
        ..s.tx,
        validity_range: range(bid_deadline - 10_000, bid_deadline + 1),
      },
    ),
  )
}

test t09_unbounded_validity_fails() fail {
  let s = settlement(three())
  settles(
    with_tx(s, Transaction { ..s.tx, validity_range: interval.everything }),
  )
}

test t09_upper_bound_exactly_at_deadline_passes() {
  // exclusive upper bound == bid_deadline: the tx cannot be valid at the deadline
  let s = settlement(three())
  settles(
    with_tx(
      s,
      Transaction {
        ..s.tx,
        validity_range: range(bid_deadline - 10_000, bid_deadline),
      },
    ),
  )
}

test t09_non_allowlisted_provider_fails() fail {
  // validly signed by vk2, which is not in provider_vkeys
  expect verify_bid(campaign_policy, bid2(), sig2)
  let s = settlement(three())
  settles(
    Settlement {
      ..s,
      redeemer: SettleRedeemer { ..s.redeemer, bid: bid2(), signature: sig2 },
    },
  )
}

// ---------------------------------------------------------------------------
// 10. A refund before the deadline fails; after the deadline it passes
// ---------------------------------------------------------------------------

/// Inputs [fee, pledge 0..n-1]; outputs [refund 0..n-1] (refund i at index i).
fn refund_tx(ps: List<P>, lo: Int) -> Transaction {
  Transaction {
    ..placeholder,
    inputs: [fee_input(), ..list.indexed_map(ps, pledge_input)],
    reference_inputs: [campaign_input(campaign_datum(), campaign_policy)],
    outputs: list.indexed_map(ps, fn(i, x) { refund_output(i, x, 0) }),
    validity_range: range(lo, lo + 3_600_000),
  }
}

fn refunds(tx: Transaction, i: Int, x: P, out_ix: Int) -> Bool {
  let d: Data = pledge_datum(i, x)
  bloc.bloc.spend(
    campaign_policy,
    Some(d),
    Refund { input_index: i + 1, output_index: out_ix },
    pledge_ref(i),
    tx,
  )
}

test t10_refund_after_deadline_passes() {
  let ps = three()
  let tx = refund_tx(ps, refund_deadline + 1)
  refunds(tx, 0, p(1), 0) && refunds(tx, 1, p(2), 1) && refunds(tx, 2, p(3), 2)
}

test t10_refund_before_deadline_fails() fail {
  refunds(refund_tx(three(), refund_deadline - 60_000), 0, p(1), 0)
}

test t10_refund_at_deadline_fails() fail {
  // lower bound inclusive == deadline is not "entirely after"
  refunds(refund_tx(three(), refund_deadline), 0, p(1), 0)
}

test t10_prop_refund_before_deadline_fails(
  lo via fuzz.int_between(0, refund_deadline),
) fail {
  refunds(refund_tx(three(), lo), 1, p(2), 1)
}

test t10_prop_refund_after_deadline_passes(
  delta via fuzz.int_between(1, 1_000_000_000),
) {
  refunds(refund_tx(three(), refund_deadline + delta), 1, p(2), 1)
}

test t10_refund_without_validity_start_fails() fail {
  let tx = Transaction {
    ..refund_tx(three(), 0),
    validity_range: interval.everything,
  }
  refunds(tx, 0, p(1), 0)
}

test t10_refund_partial_value_fails() fail {
  let ps = three()
  let tx = refund_tx(ps, refund_deadline + 1)
  let short = refund_output(0, p(1), 1)
  refunds(
    Transaction { ..tx, outputs: set_at(tx.outputs, 0, short) },
    0,
    p(1),
    0,
  )
}

test t10_refund_double_satisfaction_fails() fail {
  // two pledges of the same member cannot share one refund output
  let tx = refund_tx([p(1), p(1)], refund_deadline + 1)
  let d0: Data = pledge_datum(0, p(1))
  bloc.bloc.spend(
    campaign_policy,
    Some(d0),
    Refund { input_index: 1, output_index: 0 },
    pledge_ref(0),
    tx,
  ) && bloc.bloc.spend(
    campaign_policy,
    Some(d0),
    Refund { input_index: 2, output_index: 0 },
    pledge_ref(1),
    Transaction {
      ..tx,
      inputs: set_at(
        tx.inputs,
        2,
        Input {
          ..pledge_input(1, p(1)),
          output: Output {
            ..pledge_input(1, p(1)).output,
            datum: InlineDatum(d0),
          },
        },
      ),
    },
  )
}

test t10_refund_needs_campaign_reference() fail {
  let tx = Transaction {
    ..refund_tx(three(), refund_deadline + 1),
    reference_inputs: [],
  }
  refunds(tx, 0, p(1), 0)
}

// ---------------------------------------------------------------------------
// Spend handler, stray UTxOs, publish
// ---------------------------------------------------------------------------

test spend_settle_without_withdrawal_fails() fail {
  let s = settlement(three())
  spends_all(with_tx(s, Transaction { ..s.tx, withdrawals: [] }))
}

test spend_settle_wrong_input_index_fails() fail {
  let s = settlement(three())
  let d: Data = pledge_datum(0, p(1))
  bloc.bloc.spend(
    campaign_policy,
    Some(d),
    Settle { input_index: 2, withdrawal_index: 0 },
    pledge_ref(0),
    s.tx,
  )
}

test stray_utxo_without_datum_cannot_join_settlement() fail {
  // a datum-less UTxO at the script address makes any settlement that spends it fail
  let s = settlement(three())
  let stray = Input {
    ..pledge_input(3, p(1)),
    output: Output { ..pledge_input(3, p(1)).output, datum: NoDatum },
  }
  let tx = Transaction {
    ..s.tx,
    inputs: list.concat(s.tx.inputs, [stray]),
    outputs: list.concat(
      list.take(s.tx.outputs, 4),
      [refund_output(3, p(1), unit_price)],
    ),
  }
  settles(
    Settlement {
      tx,
      redeemer: SettleRedeemer {
        ..s.redeemer,
        pairs: list.concat(s.redeemer.pairs, [Pair(4, 4)]),
      },
    },
  )
}

test stray_utxo_without_datum_cannot_be_refunded() fail {
  let tx = refund_tx([p(1)], refund_deadline + 1)
  bloc.bloc.spend(
    campaign_policy,
    None,
    Refund { input_index: 1, output_index: 0 },
    pledge_ref(0),
    tx,
  )
}

test stray_utxo_outside_tx_does_not_block_settlement() {
  // strays are simply not included by the settlement builder
  let s = settlement(three())
  settles(s)
}

test campaign_utxo_cannot_be_spent() fail {
  let s = settlement(three())
  let c = campaign_input(campaign_datum(), campaign_policy)
  let tx = Transaction { ..s.tx, inputs: list.concat(s.tx.inputs, [c]) }
  let d: Data = campaign_datum()
  bloc.bloc.spend(
    campaign_policy,
    Some(d),
    Settle { input_index: 4, withdrawal_index: 0 },
    c.output_reference,
    tx,
  )
}

test publish_allows_registration() {
  bloc.bloc.publish(
    campaign_policy,
    Void,
    RegisterCredential { credential: Script(own_hash), deposit: Never },
    placeholder,
  )
}

test publish_rejects_deregistration() fail {
  bloc.bloc.publish(
    campaign_policy,
    Void,
    UnregisterCredential { credential: Script(own_hash), refund: Never },
    placeholder,
  )
}

// ---------------------------------------------------------------------------
// Campaign one-shot policy
// ---------------------------------------------------------------------------

const seed: OutputReference =
  OutputReference {
    transaction_id: #"5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e",
    output_index: 1,
  }

fn mint_tx(qty: Int, spend_seed: Bool, datum: CampaignDatum) -> Transaction {
  let seed_input = Input { ..fee_input(), output_reference: seed }
  let d: Data = datum
  Transaction {
    ..placeholder,
    inputs: if spend_seed {
      [seed_input]
    } else {
      [fee_input()]
    },
    mint: assets.from_asset(campaign_policy, bloc_id, qty),
    outputs: [
      Output {
        address: script_address(),
        value: assets.from_lovelace(3_000_000)
          |> assets.add(campaign_policy, bloc_id, qty),
        datum: InlineDatum(d),
        reference_script: None,
      },
    ],
  }
}

fn mints(tx: Transaction) -> Bool {
  campaign.campaign.mint(seed, Void, campaign_policy, tx)
}

test campaign_mint_passes() {
  mints(mint_tx(1, True, campaign_datum()))
}

test campaign_mint_without_seed_fails() fail {
  mints(mint_tx(1, False, campaign_datum()))
}

test campaign_mint_two_fails() fail {
  mints(mint_tx(2, True, campaign_datum()))
}

test campaign_mint_bad_deadlines_fails() fail {
  mints(
    mint_tx(
      1,
      True,
      CampaignDatum { ..campaign_datum(), refund_deadline: bid_deadline },
    ),
  )
}

test campaign_mint_bad_vkey_fails() fail {
  mints(
    mint_tx(
      1,
      True,
      CampaignDatum { ..campaign_datum(), provider_vkeys: [#"00"] },
    ),
  )
}

test campaign_mint_datum_must_name_token() fail {
  mints(mint_tx(1, True, CampaignDatum { ..campaign_datum(), bloc_id: "x" }))
}

test campaign_burn_passes() {
  mints(
    Transaction {
      ..placeholder,
      mint: assets.from_asset(campaign_policy, bloc_id, -1),
    },
  )
}

// ---------------------------------------------------------------------------
// ed25519 / bid message vectors (Node @noble/curves, see header)
// ---------------------------------------------------------------------------

test vec_bid_message_layout_matches_ts() {
  bid_message(campaign_policy, bid1()) == msg1
}

test vec_bid_message_script_address_matches_ts() {
  bid_message(campaign_policy, bid3()) == msg3
}

test vec_signatures_verify() {
  and {
    verify_bid(campaign_policy, bid1(), sig1),
    verify_bid(campaign_policy, bid2(), sig2),
    verify_bid(campaign_policy, bid3(), sig3),
  }
}

test vec_wrong_policy_rejects() {
  !verify_bid(
    #"c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
    bid1(),
    sig1,
  )
}

test vec_wrong_signer_rejects() {
  !verify_bid(campaign_policy, bid1(), sig2)
}

test vec_short_key_rejected_not_errored() {
  // our length checks turn a malformed key into False instead of a crash
  !verify_bid(campaign_policy, Bid { ..bid1(), provider_vkey: #"00" }, sig1)
}

test vec_layout_length() {
  // 8 + 28 + (1+11) + (1+32) + (1+28) + (1+4) + 8 + 8 + 32 + (1+28) + (1+28)
  bytearray.length(msg1) == 221
}

// ---------------------------------------------------------------------------
// Benchmarks: withdraw cost with N pledges. Subtract the matching
// `bench_fixture_nN` (cost of building the fixture alone) to get the handler cost.
// ---------------------------------------------------------------------------

fn uniform(n: Int) -> List<P> {
  list.repeat(p(2), n)
}

fn fixture_touch(s: Settlement) -> Bool {
  list.length(s.tx.inputs) > 0 && list.length(s.tx.outputs) > 0 && list.length(
    s.redeemer.pairs,
  ) >= 0
}

test bench_settle_n1() {
  settles(settlement(uniform(1)))
}

test bench_fixture_n1() {
  fixture_touch(settlement(uniform(1)))
}

test bench_settle_n5() {
  settles(settlement(uniform(5)))
}

test bench_fixture_n5() {
  fixture_touch(settlement(uniform(5)))
}

test bench_settle_n10() {
  settles(settlement(uniform(10)))
}

test bench_fixture_n10() {
  fixture_touch(settlement(uniform(10)))
}

test bench_settle_n20() {
  settles(settlement(uniform(20)))
}

test bench_fixture_n20() {
  fixture_touch(settlement(uniform(20)))
}

test bench_settle_n40() {
  settles(settlement(uniform(40)))
}

test bench_fixture_n40() {
  fixture_touch(settlement(uniform(40)))
}

// ---------------------------------------------------------------------------
// Context dumps for on-chain cost measurement (scripts/measure.sh): each
// `ctx_*` test traces the CBOR of a full V3 ScriptContext, which is then fed to
// the compiled script with `aiken uplc eval`.
// ---------------------------------------------------------------------------

type Ctx {
  tx: Transaction,
  redeemer: Data,
  info: Info,
}

type Info {
  IMinting(ByteArray)
  ISpending(OutputReference, Option<Data>)
  IRewarding(Credential)
}

fn dump(n: Int) -> Bool {
  let s = settlement(uniform(n))
  let r: Data = s.redeemer
  let w: Data = Ctx {
    tx: s.tx,
    redeemer: r,
    info: IRewarding(Script(own_hash)),
  }
  trace @"withdraw": bytearray.to_hex(cbor.serialise(w))
  list.all(
    list.range(1, n),
    fn(k) {
      let d: Data = pledge_datum(k - 1, p(2))
      let sr: Data = Settle { input_index: k, withdrawal_index: 0 }
      let c: Data = Ctx {
        tx: s.tx,
        redeemer: sr,
        info: ISpending(pledge_ref(k - 1), Some(d)),
      }
      trace @"spend": bytearray.to_hex(cbor.serialise(c))
      True
    },
  )
}

test ctx_n1() {
  dump(1)
}

test ctx_n5() {
  dump(5)
}

test ctx_n10() {
  dump(10)
}

test ctx_n20() {
  dump(20)
}

test ctx_n30() {
  dump(30)
}

test ctx_n40() {
  dump(40)
}

test ctx_n50() {
  dump(50)
}

test ctx_info_constructor_indices() {
  // ScriptInfo: Minting = 0, Spending = 1, Rewarding = 2 (Plutus V3)
  let m: Data = IMinting(#"")
  let r: Data = IRewarding(Script(#""))
  m != r
}

// ---------------------------------------------------------------------------
// Data shape vectors: CBOR produced by packages/bloc-contract (toAikenCbor)
// must equal Aiken's own serialisation of the same records.
// ---------------------------------------------------------------------------

test vec_pledge_datum_cbor_matches_ts() {
  let d: Data = pledge_datum(0, p(2))
  cbor.serialise(d) == #"d8799f4b6573696d2d65752d333064d8799fd8799f581c00000000000000000000000000000000000000000000000000000001ffd8799fd8799fd8799f581ce1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1ffffffff021a004c4b40ff"
}

test vec_campaign_datum_cbor_matches_ts() {
  let d: Data = campaign_datum()
  cbor.serialise(d) == #"d8799f4b6573696d2d65752d3330645820ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4ddd8799f581ca5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5445553444dff1896011b000001a0c4506c001b000001a1ee565e009f5820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa58208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5cffff"
}

test vec_settle_redeemer_cbor_matches_ts() {
  let d: Data = SettleRedeemer {
    bid: bid1(),
    signature: sig1,
    pairs: [Pair(1, 1)],
  }
  cbor.serialise(d) == #"d8799fd8799f4b6573696d2d65752d3330645820ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4ddd8799f581ca5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5445553444dff1a003d09001b000001a3185c500058208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5cd8799fd8799f581cb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1ffd8799fd8799fd8799f581cb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2ffffffffff58406d6bd112a0e4269234fd1eb8436348aa8ef158be43e4ccc448185b83345b19da30cc690d9c2be068b5fbc1300d7b2c0b1c4f972d013ff16d35ff13f66081dc05a10101ff"
}

test vec_spend_redeemers_cbor_match_ts() {
  let s: Data = Settle { input_index: 3, withdrawal_index: 0 }
  let r: Data = Refund { input_index: 3, output_index: 2 }
  and {
    cbor.serialise(s) == #"d8799f0300ff",
    cbor.serialise(r) == #"d87a9f0302ff",
  }
}

test vec_out_ref_cbor_matches_ts() {
  let d: Data = pledge_ref(0)
  cbor.serialise(d) == #"d8799f5820777777777777777777777777777777777777777777777777777777777777777700ff"
}
