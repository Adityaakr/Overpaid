//// Vendored and adapted from Anastasia Labs `aiken-design-patterns` v1.9.0
//// (commit 0594253ccc9c4f12e986c90105376b34f9ab1270), MIT licensed, see
//// LICENSE-aiken-design-patterns in this directory.
////
//// - `validate_withdraw_minimal`: verbatim logic of
////   `stake_validator.validate_withdraw_minimal`.
//// - `one_to_one_fold`: `multi_utxo_indexer.one_to_one_no_redeemer`, adapted to
////   (1) thread an accumulator through the validation callback (the settle logic
////   needs sum(quantity)), (2) reserve the first `reserved_outputs` outputs so they
////   can never be paired (output #0 pays the provider), and (3) walk the outputs
////   list incrementally instead of `list.at` per pair (O(n) instead of O(n^2)).
////   Semantics otherwise unchanged: every input whose payment credential is the
////   script must be listed, in order, input indices equal to the input's position,
////   output indices strictly increasing, and no pair may be left over.

use aiken/collection/list
use aiken/crypto.{ScriptHash}
use cardano/address.{Credential, Script}
use cardano/assets.{Lovelace}
use cardano/transaction.{Input, Output}

/// Only the presence of the given staking script among the withdrawals is
/// checked (at the given index), regardless of amount or redeemer.
pub fn validate_withdraw_minimal(
  withdraw_script_hash: ScriptHash,
  withdrawals: Pairs<Credential, Lovelace>,
  withdrawal_index: Int,
) -> Bool {
  expect Some(withdrawal_pair) = withdrawals |> list.at(withdrawal_index)
  withdrawal_pair.1st == Script(withdraw_script_hash)
}

/// One-to-one input/output pairing for every input of `spending_script_hash`,
/// folding `validation_logic` over the pairs. `validation_logic` must fail
/// (`expect`/`fail`) on invalid pairs; it returns the next accumulator.
pub fn one_to_one_fold(
  indices: Pairs<Int, Int>,
  spending_script_hash: ScriptHash,
  inputs: List<Input>,
  outputs: List<Output>,
  reserved_outputs: Int,
  start: acc,
  validation_logic: fn(Int, Input, Int, Output, acc) -> acc,
) -> acc {
  let cred = Script(spending_script_hash)
  go(
    cred,
    inputs,
    indices,
    0,
    reserved_outputs - 1,
    list.drop(outputs, reserved_outputs),
    start,
    validation_logic,
  )
}

// `outs` is always the outputs list starting at index `out0 + 1`.
fn go(
  cred: Credential,
  inputs: List<Input>,
  indices: Pairs<Int, Int>,
  i: Int,
  out0: Int,
  outs: List<Output>,
  acc: acc,
  f: fn(Int, Input, Int, Output, acc) -> acc,
) -> acc {
  when inputs is {
    [] -> {
      expect [] = indices
      acc
    }
    [input, ..rest] ->
      if input.output.address.payment_credential == cred {
        when indices is {
          [] -> fail @"More UTxOs of the script are spent than specified"
          [Pair(in1, out1), ..rest_indices] -> {
            expect i == in1
            expect out1 > out0
            expect [out_utxo, ..rest_outs] = list.drop(outs, out1 - out0 - 1)
            go(
              cred,
              rest,
              rest_indices,
              i + 1,
              out1,
              rest_outs,
              f(in1, input, out1, out_utxo, acc),
              f,
            )
          }
        }
      } else {
        go(cred, rest, indices, i + 1, out0, outs, acc, f)
      }
  }
}
