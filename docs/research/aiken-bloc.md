# Aiken research for the `bloc` contracts (Plutus V3)

Researched 2026-10-06. Every claim below comes from source I read or a command I ran. Paths are shortened as follows:
- `DP/` = `/private/tmp/claude-501/-Users-adityakrx-ombud/db8e4563-317e-4dd6-87ae-2ab7bdf7790a/scratchpad/refs/aiken-design-patterns/` (shallow clone, commit `0594253c`, 2026-09-30)
- `STD/` = `DP/build/packages/aiken-lang-stdlib/lib/` (stdlib v4.0.0, fetched by `aiken check`)
- `FUZZ/` = `DP/build/packages/aiken-lang-fuzz/lib/` (fuzz v3.0.0)
- `EVO/` = `@evolution-sdk/evolution@0.5.13` `src/` (from `npm pack`, in scratchpad `evo/package/src/`)
- `SKEL/` = scratchpad `skel/`, a throwaway project I used to compile-check the snippets in this doc. It is not product code.

## 1. Summary

- Aiken **v1.1.24+bacbeb3** is installed from the official GitHub release binary, and the sha256 matched. `aiken --version` works from `/opt/homebrew/bin/aiken`.
- The design-patterns repo pins `compiler = "v1.1.24"`, stdlib `v4.0.0`, fuzz `v3.0.0` and `keyan-m/aiken-scott-utils v1.5.0` (`DP/aiken.toml:3,14-26`). On this machine `aiken check` reports **256 tests passed, 0 failed** ("22234 checks, 0 errors, 0 warnings"), and `aiken build` is clean.
- The withdraw-zero helpers are in `stake_validator` and the multi-input pairing is `multi_utxo_indexer.one_to_one_no_redeemer`. This pairing covers everything we need. It requires every input at the script to be listed, in order, with input and output indices strictly increasing.
- `verify_ed25519_signature(key, msg, sig)` returns False for a bad signature. It **errors** (halts the script) when the key is not 32 bytes or the signature is not 64 bytes. I verified both with tests in SKEL.
- Off-chain, Evolution `UPLC.applyParamsToScript(compiledCode, [Data...])` and `aiken blueprint apply` produce **byte-identical** scripts with the same hash. `new PlutusV3({bytes: hex(compiledCode)})` + `ScriptHash.fromScript` reproduces Aiken's `hash`. I verified this in node.
- Script stake registration: Conway `RegCert` (CDDL tag 7) with a deposit equal to `keyDeposit`. On preprod that deposit is **2_000_000 lovelace** (Koios, protocol version 11.0). The script runs under the `publish` purpose, so `bloc_settle` needs a `publish` handler.
- **Design gotcha:** pledge and settle cannot each take the other's hash as a parameter because that is circular. Put the `spend` and `withdraw` handlers in **one** validator (as `DP/validators/examples/multi-utxo-indexer.ak:15-61` does), or read the pledge hash from the campaign datum.

## 2. Toolchain install (commands that worked)

`brew install` was not used. I used the release binary, which matches the 1.1.24 release exactly (released 2026-09-26).
```sh
B=https://github.com/aiken-lang/aiken/releases/download/v1.1.24
curl -sLO $B/aiken-aarch64-apple-darwin.tar.gz
curl -sLO $B/aiken-aarch64-apple-darwin.tar.gz.sha256
shasum -a 256 aiken-aarch64-apple-darwin.tar.gz   # 5faa52fb...419676 == .sha256
tar xzf aiken-aarch64-apple-darwin.tar.gz
mkdir -p ~/.aiken/bin && cp aiken-aarch64-apple-darwin/aiken ~/.aiken/bin/ && chmod +x ~/.aiken/bin/aiken
xattr -d com.apple.quarantine ~/.aiken/bin/aiken 2>/dev/null
ln -sf ~/.aiken/bin/aiken /opt/homebrew/bin/aiken
aiken --version   # -> aiken v1.1.24+bacbeb3
```
Other notes:
- `aiken new org/name` scaffolds `compiler = "v1.1.24"`, `plutus = "v3"` and stdlib `v4.0.0`. The fuzz dependency must be added by hand.
- `aiken test` is an alias of `aiken check` (CHANGELOG v1.1.22).
- v1.1.24 adds first-class UPLC `Value` and `{policy: {name: qty}}` literals. v1.1.23 added PV11 cost models, which matters because preprod is at PV 11.0.
- `aiken build` defaults to silent traces. In SKEL the pledge script is 473 bytes with the default and with `-t silent`, and 586 bytes with `-t verbose`. Use `aiken check` (verbose by default) to see `expect`/trace messages.

## 3. aiken-design-patterns APIs

### stake_validator (`DP/lib/aiken-design-patterns/stake-validator.ak`)
```aiken
pub fn validate_withdraw(withdraw_script_hash: ScriptHash, redeemers: Pairs<ScriptPurpose, Redeemer>,
  withdraw_redeemer_index: Int, withdraw_redeemer_validator: fn(Redeemer) -> Bool) -> Bool        // :27
pub fn validate_withdraw_with_amount(withdraw_script_hash: ScriptHash, redeemers: Pairs<ScriptPurpose, Redeemer>,
  withdraw_redeemer_index: Int, withdrawals: Pairs<Credential, Lovelace>, withdrawal_index: Int,
  withdraw_redeemer_validator: fn(Redeemer, Lovelace) -> Bool) -> Bool                            // :44
pub fn validate_withdraw_minimal(withdraw_script_hash: ScriptHash,
  withdrawals: Pairs<Credential, Lovelace>, withdrawal_index: Int) -> Bool                        // :69
```
What each one checks:
- `validate_withdraw` looks up `redeemers[idx]` and expects its purpose to be `Withdraw(Script(hash))`. It then passes the redeemer Data to the callback. It uses `utils.get_withdraw_scripts_redeemer_at` (`DP/lib/aiken-design-patterns/utils.ak:18-26`).
- `validate_withdraw_with_amount` does the same, and also expects `withdrawals[widx].1st == Script(hash)`. The callback receives the amount, so the spender can assert `== 0` (`:52-63`).
- `validate_withdraw_minimal` checks only `withdrawals[idx].1st == Script(hash)` (`:74-76`). Our pledge `Settle` can use it, with the index taken from the spend redeemer. That is O(1) instead of a list scan.
- Example usage is in `DP/validators/examples/stake-validator.ak:15-48`. That example passes the indices in the spend redeemer and uses backpassing: `let r, amt <- stake_validator.validate_withdraw_with_amount(...)`.
- The tests are `DP/lib/tests/stake-validator.ak:10-79`. They are property tests over `fuzz.bytearray_fixed(28)`, and each one has a `fail` twin that uses a wrong hash, `blake2b_224(script_hash)`.

### multi_utxo_indexer (`DP/lib/aiken-design-patterns/multi-utxo-indexer.ak`)
```aiken
pub fn one_to_one_no_redeemer(indices: Pairs<Int, Int>, spending_script_hash: ScriptHash,
  inputs: List<Input>, outputs: List<Output>,
  validation_logic: fn(Int, Input, Int, Output) -> Bool) -> Bool                                 // :18
pub fn one_to_one_with_redeemer(indices: Pairs<Int, Int>, spending_script_hash: ScriptHash,
  stake_script_hash: ScriptHash, inputs: List<Input>, outputs: List<Output>,
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  spend_redeemer_coercer_and_stake_credential_extractor: fn(Data) -> (a, Credential),
  validation_logic: fn(Int, Input, a, Int, Output) -> Bool) -> Bool                               // :68
```
`one_to_one_no_redeemer` walks **all** `tx.inputs` (`:26-53`):
- If an input's `payment_credential == Script(spending_script_hash)`, the next pair `(in1,out1)` must satisfy `i == in1 && in1 > in0 && out1 > out0`. The starting values are `-1, -1` (`:38`).
- It then fetches `outputs[out1]` and calls `validation_logic`. If that returns False it fails with "Validation failed".
- A script input that has no pair left fails with "More UTxOs of the script are spent than specified" (`:36`).
- At the end it does `expect processed_indices == []` (`:54`), so you cannot list extra pairs.
- Net result: a bijection between every pledge input and distinct outputs, with no double-counting. Your callback **must** check the output itself (address, value, datum).
- It matches only the payment credential. Pledge UTxOs with any stake part still count.

`one_to_one_with_redeemer` walks `indices`. It first filters `Spend` redeemers by the stake credential that the coercer extracts (`:81-100`), then requires `inputs[in1]` to be at the script (`:115-116`). Use it only if per-pledge spend redeemers carry data that settle needs.

Example: `DP/validators/examples/multi-utxo-indexer.ak:15-61`. This single validator has `spend` and `withdraw` handlers. The spend handler resolves its own address, gets `own_hash`, and requires a withdrawal of that **same hash** (`:25-38`). The withdraw handler calls `one_to_one_no_redeemer(indices: redeemer, spending_script_hash: own_script_hash, ...)` (`:46-61`).

Tests: `DP/lib/tests/multi-utxo-indexer.ak`. The fuzzer at `:12-62` builds sorted wallet and script inputs plus matching outputs and indices. `success__one_to_one_no_redeemer` is at `:64`. `fail__..._no_output ... fail` at `:75` passes `outputs: []`.

Useful utils (`DP/lib/aiken-design-patterns/utils.ak`):
- `resolve_output_reference(inputs, out_ref) -> Output` (`:42`)
- `sort_inputs` (`:32`)
- `utxo_is_spent` (`:28`)
- input fuzzers `user_inputs_fuzzer` and `specific_script_input_fuzzer(hash, datum)`, used in the tests

## 4. stdlib v4.0.0 APIs we need

**Transaction** (`STD/cardano/transaction.ak:55-78`) has these fields: `inputs`, `reference_inputs`, `outputs: List<Output>`, `fee`, `mint: Assets`, `certificates`, `withdrawals: Pairs<Credential, Lovelace>`, `validity_range: ValidityRange`, `extra_signatories: List<VerificationKeyHash>`, `redeemers: Pairs<ScriptPurpose, Redeemer>`, `datums`, `id`, `votes`, `proposal_procedures`, `current_treasury_amount`, `treasury_donation`.

Related types:
- `Input { output_reference, output }` (`:85`)
- `OutputReference { transaction_id, output_index }` (`:93`)
- `Output { address, value: Assets, datum: Datum, reference_script: Option<ScriptHash> }` (`:99`)
- `Datum = NoDatum | DatumHash | InlineDatum(Data)`

Ordering rules:
- Withdrawals are ordered by credential, and `Script` sorts **before** `VerificationKey` (`:62-64`).
- Redeemers are ordered `Spend < Mint < Publish < Withdraw < Vote < Propose` (`:67-69`).

Helper functions:
- `find_input(inputs, out_ref) -> Option<Input>` (`:135`)
- `resolve_input(inputs, out_ref) -> Output` (`:154`)
- `find_script_outputs(outputs, script_hash) -> List<Output>` (`:201`)

**Interval** (`STD/aiken/interval.ak`): `Interval { lower_bound, upper_bound }`, where each bound is `IntervalBound { bound_type: NegativeInfinity | Finite(Int) | PositiveInfinity, is_inclusive }` (`:103-120`). Times are POSIX **milliseconds** (`transaction.ak:80`).
- `is_entirely_after(self, point) -> Bool` (`:359`) is True when the lower bound is strictly greater than `point`. It is False when the lower bound is `NegativeInfinity`, so the tx **must set `validFrom`**. Use it for Refund: `is_entirely_after(tx.validity_range, refund_deadline)`.
- `is_entirely_before(self, point) -> Bool` (`:381`) is True when the upper bound is strictly less than `point`. It is False when the upper bound is `+∞`, so the tx **must set a TTL / validTo**. Use it for Settle: `is_entirely_before(range, min(bid_expiry, deadline))`.
- Constructors for tests: `after`, `entirely_after`, `before`, `entirely_before`, `between`, `entirely_between` (`:132-225`). Other functions: `contains`, `is_empty`, `includes`, `intersection`, `hull`.

**Assets** (`STD/cardano/assets.ak`): `opaque type Assets` (`:47`). It never holds zero quantities.
- `quantity_of(self, policy_id, asset_name) -> Int` (`:416`)
- `lovelace_of(self) -> Int` (`:406`)
- `tokens(self, policy) -> Dict<AssetName, Int>` (`:426`)
- `has_nft`, `has_nft_strict` (`:268,308`)
- `without_lovelace` (`:555`)
- `match(...)` (`:362`)
- `from_asset`, `from_lovelace`, `merge`, `negate`, `flatten`, `policies`
- `ada_policy_id = ""` and `ada_asset_name = ""`

For a one-shot mint, check `tx.mint |> assets.tokens(policy_id) |> dict.to_pairs` against `[Pair(name, 1)]`. That pattern compiles in SKEL.

**Crypto** (`STD/aiken/crypto.ak`):
- `verify_ed25519_signature(key: VerificationKey, msg: ByteArray, sig: Signature) -> Bool` (`:130-136`) wraps the builtin.
- Measured in SKEL `aiken check`:
  - A valid signature gives True. A wrong message gives False.
  - A 1-byte key gives the error `"Ed25519S PublicKey should be 32 bytes but it was 1"`.
  - A 1-byte signature gives the error `"Ed25519S Signature should be 64 bytes but it was 1"`.
  - So a malformed signature in the redeemer aborts the script instead of returning False. That is fine for us, but don't wrap it expecting a False.
- Hash functions: `blake2b_256` (`:82`), `sha2_256` (`:102`), plus `blake2b_224` and `keccak_256`.

**Byte building** (fixed-layout bid message):
- `STD/aiken/primitive/bytearray.ak`:
  - `from_int_big_endian(n, size)` (`:23`) left-pads with zeroes. It **fails** if `n` does not fit, and also fails for negative `n` (the error is "integerToByteString encountered negative input", checked in SKEL).
  - `from_int_little_endian` (`:40`), `concat(left, right)` (`:216`), `length` (`:127`), `slice`, `take`, `drop`, `from_string`, `to_int_big_endian` (`:326`).
- `STD/aiken/cbor.ak`: `serialise(Data) -> ByteArray` (`:105`) and `deserialise` (`:45`).
  - CBOR uses indefinite arrays: `cbor.serialise((1,2)) == #"9f0102ff"` (`:99`).
  - **Prefer a fixed concat layout** such as `"BLOC" ‖ campaign_policy(28) ‖ provider_vkh(28) ‖ be(amount,8) ‖ be(expiry,8) ‖ …`. It is cheaper and easier to reproduce byte-for-byte in TS than CBOR.
  - Optionally hash it with `blake2b_256` before verifying.

**Certificate** (`STD/cardano/certificate.ak:11-41`): `RegisterCredential { credential, deposit: Never }`. The deposit is always `None` in the V3 context because of a ledger bug (`:17-21`; IntersectMBO/cardano-ledger#4571). Never pattern-match on its value.

## 5. Validator syntax skeleton (v1.1.24)

This is a reference sketch. Its handler signatures, imports and constructs (`expect`, `when`, `assets.tokens`, `dict.to_pairs`, `verify_ed25519_signature`, `from_int_big_endian`, `publish`/`else`) were compiled in `SKEL/validators/skel.ak`. The DP-library calls need the `anastasia-labs/aiken-design-patterns` and `keyan-m/aiken-scott-utils` deps, or a vendored copy, and were not compiled in this exact form.

```aiken
use aiken/collection/{dict, list}
use aiken/crypto.{ScriptHash, VerificationKeyHash, verify_ed25519_signature}
use aiken/interval
use aiken/primitive/bytearray
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
// NOTE: all `use` lines must come first; a `use` after a definition is a parse error.

pub type PledgeRedeemer { Settle { withdrawal_index: Int }  Refund }

validator campaign_nft(seed: OutputReference) {            // params become blueprint "parameters"
  mint(_r: Data, policy_id: PolicyId, tx: Transaction) {
    expect list.any(tx.inputs, fn(i) { i.output_reference == seed })
    expect [Pair(_name, 1)] = tx.mint |> assets.tokens(policy_id) |> dict.to_pairs
    True
  }
  else(_) { fail }
}

validator bloc(provider_vk: ByteArray) {                   // spend + withdraw share ONE hash
  spend(datum: Option<PledgeDatum>, redeemer: PledgeRedeemer, own_ref: OutputReference, tx: Transaction) {
    expect Some(d) = datum
    when redeemer is {
      Settle { withdrawal_index } -> {
        let own = transaction.resolve_input(tx.inputs, own_ref)
        expect Script(own_hash) = own.address.payment_credential
        stake_validator.validate_withdraw_minimal(own_hash, tx.withdrawals, withdrawal_index)
      }
      Refund -> interval.is_entirely_after(tx.validity_range, d.refund_deadline) // + read campaign ref input
    }
  }
  withdraw(redeemer: SettleRedeemer, account: Credential, tx: Transaction) {
    expect Script(own_hash) = account
    let msg = bytearray.concat(#"424c4f43", bytearray.from_int_big_endian(redeemer.amount, 8))
    expect verify_ed25519_signature(provider_vk, msg, redeemer.sig)
    let _ii, input, _oi, output <- multi_utxo_indexer.one_to_one_no_redeemer(
      indices: redeemer.pairs, spending_script_hash: own_hash, inputs: tx.inputs, outputs: tx.outputs)
    refund_output_ok(input, output)
  }
  publish(_r: Data, _cert: Certificate, _tx: Transaction) { True }   // needed for RegCert (tag 7)
  else(_) { fail }
}
```
Handler signatures:
- `mint(redeemer, policy_id: PolicyId, tx)`
- `spend(datum: Option<D>, redeemer, own_ref: OutputReference, tx)`
- `withdraw(redeemer, account: Credential, tx)`
- `publish(redeemer, cert: Certificate, tx)`
- also `vote` and `propose`

`else(_)` catches any purpose that has no handler. Each handler is listed in the blueprint as `<module>.<validator>.<handler>`, and all handlers of one validator share the same hash (SKEL `plutus.json`). Readable boolean syntax is `and { a, b, }` / `or { … }`. Use `expect` for assertions that halt.

## 6. Tests and property tests

```aiken
use aiken/fuzz                                            // aiken-lang/fuzz v3.0.0
test ed25519_ok() { verify_ed25519_signature(#"993e…621d", #"0102030405", #"887d…b102") }
test ed25519_short_sig_errors() fail { verify_ed25519_signature(pk, msg, #"00") }   // `fail` = must error/False
test prop_be_len(n via fuzz.int_between(0, 1_000_000_000)) {
  bytearray.length(bytearray.from_int_big_endian(n, 8)) == 8
}
test prop_pairs(v via my_fuzzer()) fail { … }             // property test that must fail for all samples
```
- Fuzzers: `fuzz.int_between`, `bytearray_fixed(28)`, `list_between(f, min, max)`, `and_then`, `map`, `both`, `tuple*`, `constant`, `one_of`, `pick`, `such_that`, `sublist`, `label` (`FUZZ/aiken/fuzz.ak:17-1333`). There are Cardano-specific fuzzers in `FUZZ/cardano/fuzz.ak`.
- You compose fuzzers with backpassing, as in `DP/lib/tests/multi-utxo-indexer.ak:21-30`.
- Run options: `aiken check -m bloc` (match), `-e` (exact), `--seed N`, `--max-success N` (the default is 100 iterations). JSON output includes `execution_units` per test.
- Build a real `Transaction` value for validator tests with `transaction.placeholder` (`STD/cardano/transaction.ak:231`) and record update `Transaction { ..placeholder, inputs: [...] }`. I did not run a full tx-level test.
- To get Ed25519 test vectors, generate them in node (`crypto.generateKeyPairSync("ed25519")`; the raw public key is the last 32 bytes of the spki DER). That is how I produced the vectors above.

## 7. Blueprint and parameters

`aiken build` writes `plutus.json`. Each entry has `validators[].{title, redeemer, datum?, parameters[{title, schema}], compiledCode, hash}`. `compiledCode` is **single-CBOR-wrapped flat**, and Evolution's `getCborEncodingLevel` reports `"single"`.

CLI (`aiken blueprint --help`): `address`, `policy`, `hash`, `apply`, `convert`.
```sh
aiken blueprint apply -m <module> -v <validator> <CBOR_HEX_PARAM> -o applied.json   # ONE param per call
aiken blueprint apply -i applied.json -m <module> -v <validator> <NEXT_PARAM> -o applied2.json
aiken blueprint hash    -i applied.json -m <module> -v <validator>
aiken blueprint address -i applied.json -m <module> -v <validator> [--delegated-to <stake>] [--mainnet]
aiken blueprint policy  -i applied.json -m <module> -v <validator>
```
- The parameter is hex CBOR of Plutus Data. A 32-byte bytestring is `5820<hex>`, and `182A` is the integer 42. You can produce it with `cbor.serialise`.
- Applying a parameter removes it from `parameters` and changes the hash for **every** handler of that validator. Verified: unapplied `76a97e01…` became `3a38026f…` after the 32-byte provider key was applied.
- Apply order matters: parameters are applied left to right, so `params[0]` goes first.

## 8. Evolution SDK 0.5.13 script APIs (`EVO/`)

Import: `import { PlutusV3, ScriptHash, UPLC, Data, Bytes, Credential } from "@evolution-sdk/evolution"` (`index.ts`).
- `new PlutusV3.PlutusV3({ bytes })` (`PlutusV3.ts:11-12`). `bytes` is the decoded **single-wrapped** `compiledCode` hex.
- `ScriptHash.fromScript(script)` (`ScriptHash.ts:176`) hashes `0x03 ‖ bytes`, and `ScriptHash.toHex` gives hex.
- `UPLC.applyParamsToScript(plutusScript: string, params: ReadonlyArray<Data.Data>, options = AIKEN_DEFAULT_OPTIONS): string` (`UPLC.ts:1536-1556`).
  - It accepts single- or double-wrapped input and returns **double-wrapped** hex. Convert back with `UPLC.applySingleCborEncoding(hex)` (`:1403`) before `new PlutusV3`.
  - There is also `applyParamsToScriptWithSchema(script, params, toData)` (`:1566`) and `getCborEncodingLevel` (`:1445`).
- Data constructors: `Data.constr(index: bigint, fields)`, `Data.int(bigint)`, `Data.bytearray(hex)`, `Data.list`, `Data.map`, `Data.toCBORHex` (`Data.ts:277-309,844`).
- Credentials: `Credential.makeScriptHash(hashBytes)` and `makeKeyHash` (`Credential.ts:28-29`).
- **Verified in node** (`evo/t.mjs`): the Evolution hash of the raw `compiledCode` equals Aiken's `hash`. `applySingleCborEncoding(applyParamsToScript(code,[bytes]))` is **string-identical** to `aiken blueprint apply` output, with the same hash.

TransactionBuilder (`EVO/sdk/builders/TransactionBuilder.ts`):
- `collectFrom({inputs, redeemer?, label?})` (`:857`)
- `readFrom({referenceInputs})` (`:996`)
- `payToAddress({address, assets, datum?, script?})` (`:846`)
- `mintAssets({assets, redeemer?})` (`:960`)
- `attachScript({script})` (`:919`)
- `registerStake({stakeCredential, redeemer?})` (`:1010`)
- `registerStakeLegacy` (`:1025`)
- `deregisterStake` (`:1043`)
- `withdraw({stakeCredential, amount: bigint, redeemer?})` (`:1143`). Its doc says to use `amount: 0n` "to trigger a stake validator… (coordinator pattern)" (`:1129-1131`).
- Param interfaces are in `operations/Operations.ts:44-275`.

Redeemer modes (`RedeemerBuilder.ts:30-127`):
- `RedeemerArg = Data | SelfRedeemerFn | BatchRedeemerBuilder`.
- `Self` receives `{index, utxo}` with the **final sorted input index**.
- `Batch {all: (inputs: IndexedInput[]) => Data, inputs: UTxO[]}` gets all of them.
- Use Batch for the settle `withdraw` redeemer so the `Pairs<Int,Int>` input indices are computed after coin selection.
- Output indices follow `payToAddress` call order, with change appended later. This is inferred from the builder design and needs a test on a real tx.

## 9. Stake registration and withdraw-zero (Conway)

- A withdraw-zero validator only runs if its script stake credential is **registered**. You register it once per script hash. A new hash, for example after re-applying parameters, needs a new registration.
- Use the Conway `RegCert` (`reg_cert = (7, stake_credential, coin)`) with `coin = keyDeposit`. Preprod `stakeAddressDeposit = 2000000` (Koios `cli_protocol_params`, protocol version 11.0).
- Evolution `registerStake` builds `Certificate.RegCert({stakeCredential, coin: keyDeposit})` from the fetched protocol params (`operations/Stake.ts:58-63`). It **requires a redeemer** for a script credential (`:43-51`), so the script runs as `Publish`. Give `bloc` a `publish` handler, either a permissive `True` or one that checks the certificate is `RegisterCredential` for its own credential.
- Ledger references: reg_cert type 7 requires a stake-credential witness and includes the deposit ([developers.cardano.org: Register stake address](https://developers.cardano.org/docs/operate-a-stake-pool/register-stake-address/)). The V3 context hides the deposit ([cardano-ledger#4571](https://github.com/IntersectMBO/cardano-ledger/issues/4571)).
- The deposit is refunded by `deregisterStake`, and the script runs again then.
- `registerStakeLegacy` (tag 0, no deposit) also demands a redeemer in Evolution (`Stake.ts:119-127`). As I understand the ledger, tag 0 needs no witness, so that redeemer could be rejected as extra. I did not verify this, so **avoid it** and use `registerStake`.
- The trick at settlement:
  1. Add `withdraw({stakeCredential: Script(bloc_hash), amount: 0n, redeemer: Batch(...)})`. The amount must equal the full reward balance, which is 0 because the credential is never delegated.
  2. The heavy logic runs once in `withdraw`.
  3. Each pledge `spend` only checks that the withdrawal is present (`validate_withdraw_minimal`).
- Evolution needs the script for the withdrawal. Attach it (`attachScript`) or reference it from a reference-script UTxO.

## 10. Gotchas

1. **Hash cycle.** If `bloc_pledge` is parameterized by `settle_hash` and `bloc_settle` needs `pledge_hash`, neither can be compiled first. Use one validator with `spend`+`withdraw`+`publish` (DP example `multi-utxo-indexer.ak:15-61`), or have settle read the pledge hash from the campaign NFT datum.
2. The index pairs must be strictly increasing and must cover **every** input at the script, including stray UTxOs sent there by others. A dust UTxO at the pledge address without a valid datum will brick a settle that has to include it. Design it out: settle can only spend what it lists, but the indexer requires all inputs at the script to be listed. Filter by the campaign token or datum inside `validation_logic`, or never put unrelated UTxOs in the same tx.
3. The `validity_range` checks need finite bounds. Refund needs `validFrom`, and Settle needs `validTo`. Both are in ms, while the off-chain SDK speaks slots.
4. `verify_ed25519_signature` errors on wrong-length key or signature. `from_int_big_endian` errors on negative or overflowing input. Validate lengths off-chain.
5. `Assets` is opaque. Compare with `quantity_of`, `lovelace_of` or `match`, never with structural `==` on Data.
6. `Certificate.RegisterCredential.deposit` is `Never`, so don't match on it.
7. Redeemer list order (`Spend<Mint<Publish<Withdraw`) differs from constructor order. Withdrawals put Script credentials before VerificationKey ones. Pass indices in redeemers rather than searching.
8. All `use` statements go at the top of a module (parse error otherwise, seen in SKEL). Each `.ak` in `validators/` is a module, and `lib/` holds shared code.
9. `aiken blueprint apply` takes one parameter per invocation. Evolution `applyParamsToScript` takes an array but returns double-CBOR, so unwrap it before `new PlutusV3`.
10. Pin `compiler = "v1.1.24"`, stdlib `v4.0.0` and fuzz `v3.0.0` in `contracts/aiken.toml`, and commit `aiken.lock`.
