# Masumi `vested_pay` v2: building the escrow txs ourselves (Evolution SDK)

Sources (cloned/fetched 2026-10-06; every claim cites file:line):
- `MPS/` = `masumi-payment-service` @ `71455701ac22` (shallow clone in scratchpad `refs/masumi-payment-service`)
- `X402/` = `npm pack @x402/cardano@2.26.0` → `refs/x402/package/` (bundled ESM; it depends on `@evolution-sdk/evolution ^0.5.9`, and 0.5.17 installed)
- `EVO/` = `@evolution-sdk/evolution@0.5.17/src` (pulled in by the x402 install, `scratchpad/x402run/node_modules`)
- `VP` = `MPS/smart-contracts/payment-v2/validators/vested_pay.ak`

## 1. Summary

- One Plutus V3 spend validator (Aiken v1.1.23, stdlib v2.1.0; `MPS/smart-contracts/payment-v2/aiken.toml:1-17`). It has 6 states and 7 redeemers. x402 `masumi` only builds the **lock** (FundsLocked). We build everything after that.
- Our 5 txs: **SubmitResult**=5 (seller), **Withdraw**=0 (seller), **SetRefundRequested**=1 (buyer), **WithdrawRefund**=3 (buyer), **AuthorizeRefund**=6 (seller). All redeemers in that set have no fields.
- Three of them are continuation txs (SubmitResult, SetRefundRequested, AuthorizeRefund): spend the escrow UTxO, re-create it at the same script address with value ≥ input, and put in a new inline datum. Every field must be copied except the ones the redeemer changes. Two are terminal txs (Withdraw, WithdrawRefund): no continuing output may carry the same `reference_signature`, and payouts are matched by **tagged outputs** whose inline datum is the spent `OutputReference`.
- Preprod default deployment (Masumi and x402 share it): script hash `a15ce9d82d2f67645fc624e2edac03c6f1c106d0ad1af5815a3b14ad`, address `addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g`. Params are `(2, [3 Masumi admin vkh], 420000)`. I checked this by running x402's `masumiEscrowAddress('cardano:preprod')` locally (§2).
- Blocker / design risk: if a result was submitted and the buyer disputes, funds go to `Disputed`. The only exits from there are seller AuthorizeRefund, buyer AuthorizeWithdrawal, or **Masumi's admins** (2-of-3 keys we don't hold) after `external_dispute_unlock_time`. We must either always cooperate (seller AuthorizeRefund) or use a custom `deployment` with our own admin keys. A custom deployment gives a different address.

## 2. Script address / hash / parameters (preprod)

| item | value | source |
|---|---|---|
| validator | `vested_pay.vested_pay.spend` (also `.else` → `fail`) | `MPS/.../plutus.json` validators[0..1]; `VP:764-766` |
| unparameterised hash (blueprint) | `2d6abca32e4b22b59e948ef22dfe682017de917a9ec088aa1bc3c64e` (not used on-chain) | plutus.json `hash` |
| params (order!) | `required_admins_multi_sig: Int`, `admin_vks: List<VerificationKeyHash>`, `cooldown_period: Int` (ms) | `VP:96-100` |
| preprod values | `2`, `[fc16a1fc…8e75, 7f781613…ada6, 89eef9ea…aaa6]`, `420000` (7 min) | `MPS/packages/payment-core/src/config.ts:430-443`; `X402/dist/esm/chunk-CSBFKQ5T.mjs:214-222` |
| admin vkh = payment key hash of | `DEFAULTS.ADMIN_WALLET{1,2,3}_PREPROD` (bech32 at config.ts:433-438; I decoded the hashes and they match x402's list) | config.ts:433-438 |
| **V2 preprod escrow address** | `addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g` (enterprise script addr, header `70`) | config.ts:466; migration `MPS/prisma/migrations/20260704120000_repoint_retired_default_v2_sources/migration.sql:168` |
| **applied script hash** | `a15ce9d82d2f67645fc624e2edac03c6f1c106d0ad1af5815a3b14ad` | bech32-decoded from the address above |
| V2 mainnet | `addr1wxs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgge2j6d` (same hash) | config.ts:468 |
| V2 registry policy id (preprod and mainnet) | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b` | config.ts:467,469; `X402/.../chunk-CSBFKQ5T.mjs:256` |
| retired/V1 (do NOT use) | V1 preprod `addr_test1wz7j4kmg…ukgwfm`, policy `7e8bdaf2…7f77` (config.ts:455-459); retired V2 policy `7890b485…a13d`, address `addr_test1wqsztux7…xqev4` (migration.sql:1-3) | |

How the address is derived:
- Masumi: `applyParamsToScript(compiledCode, [requiredAdminSignatures, adminAddrs.map(resolvePaymentKeyHash), cooldownPeriod])` → `resolvePlutusScriptAddress` (`MPS/packages/payment-source-v2/src/contract-generator.ts:50-77`). Admin order is positional and sorted by `order` (contract-generator.ts:33-36). The seed calls this with `DEFAULTS.DEFAULT_ADMIN_SIGNATURES_V2` (`MPS/prisma/seed.ts:491-493`).
- x402 (the code to copy, already Evolution): `UPLC.applyParamsToScript(code, [Data.int(2n), Data.list(vkhs.map(Data.bytearray)), Data.int(420000n)])`, then **strip one CBOR byte-string wrapper** (`unwrapCborByteString`), then `new PlutusV3.PlutusV3({bytes})`, then `ScriptHash.fromScript` (`X402/dist/esm/chunk-CSBFKQ5T.mjs:60-84, 228-254`).
- x402's embedded compiled code is byte-identical to `MPS/.../plutus.json` compiledCode (19784 hex chars; diffed locally). Run locally, `masumiEscrowAddress('cardano:preprod')` returns `addr_test1wzs4e6wc…n37w4g` and `masumiEscrowAddress('cardano:mainnet')` returns `addr1wxs4e6wc…ge2j6d`. Evolution's `applyParamsToScript` output starts `5927135927 10…`, i.e. it is double-wrapped, which is why the unwrap is needed.
- Preview has **no** default deployment (`resolveMasumiDeployment` returns null for preview: chunk-CSBFKQ5T.mjs:224-227).
- The address depends on the exact Aiken version and the param encoding. Never recompile; always use the committed compiledCode (`MPS/smart-contracts/payment-v2/README.md:27-32`; `VP:819-826`).

## 3. Datum schema (`Datum`, Constr 0, 19 fields, `VP:41-61`; blueprint `vested_pay/Datum`)

| # | field | Aiken type | Plutus data encoding |
|---|---|---|---|
| 0 | buyer | Address | `Constr0[PaymentCred, Option<StakeCred>]` |
| 1 | buyer_return_address | Option<Address> | Some=`Constr0[Address]`, None=`Constr1[]` |
| 2 | seller | Address | as 0 |
| 3 | seller_return_address | Option<Address> | as 1 |
| 4 | reference_key | ByteArray | bytes (x402: COSE_Key of seller's signData) |
| 5 | reference_signature | ByteArray | bytes, **≥16 bytes** (`VP:22,136-137`); x402: COSE_Sign1 |
| 6 | seller_nonce | ByteArray | bytes (x402: 32-byte hex) |
| 7 | buyer_nonce | ByteArray | bytes |
| 8 | agent_identifier | ByteArray | bytes, `""` if none |
| 9 | collateral_return_lovelace | Int | **≥0** (`VP:132`) |
| 10 | input_hash | ByteArray | bytes (x402: commitment digest) |
| 11 | result_hash | ByteArray | `""` until SubmitResult |
| 12 | pay_by_time | Int (POSIX ms) | |
| 13 | submit_result_time | Int | |
| 14 | unlock_time | Int | |
| 15 | external_dispute_unlock_time | Int | |
| 16 | seller_cooldown_time | Int | 0 at lock |
| 17 | buyer_cooldown_time | Int | 0 at lock |
| 18 | state | State | `Constr i []`: FundsLocked 0, ResultSubmitted 1, RefundRequested 2, Disputed 3, WithdrawAuthorized 4, RefundAuthorized 5 (`VP:32-39`; README.md States block) |

Sub-types (blueprint `cardano/address/*`):
- PaymentCredential `VerificationKey`=Constr0[bytes28] / `Script`=Constr1[bytes28]
- StakeCredential `Inline`=Constr0[Credential] / `Pointer`=Constr1[I,I,I]
- Option Some=0 / None=1

The principals (buyer and seller) **must** have a vkey payment credential: every redeemer does `expect Some(vk) = address_to_verification_key(..)` (`VP:1213-1218`, README.md:85-94). Return addresses can be any shape (README.md:100-108).

JSON example (FundsLocked, as x402 locks it; key/stake hashes are illustrative):
```json
{"constructor":0,"fields":[
 {"constructor":0,"fields":[{"constructor":0,"fields":[{"bytes":"<buyer_pkh28>"}]},
   {"constructor":0,"fields":[{"constructor":0,"fields":[{"constructor":0,"fields":[{"bytes":"<buyer_skh28>"}]}]}]}]},
 {"constructor":1,"fields":[]},
 {"constructor":0,"fields":[{"constructor":0,"fields":[{"bytes":"<seller_pkh28>"}]},{"constructor":1,"fields":[]}]},
 {"constructor":1,"fields":[]},
 {"bytes":"a401010327200621582…"}, {"bytes":"845846a2012767616464…"},
 {"bytes":"<seller_nonce32>"}, {"bytes":"<buyer_nonce>"}, {"bytes":""},
 {"int":1435230}, {"bytes":"<input_hash32>"}, {"bytes":""},
 {"int":1791300000000},{"int":1791300900000},{"int":1791302100000},{"int":1791303300000},
 {"int":0},{"int":0},{"constructor":0,"fields":[]}]}
```
(Field 0 is a base address: Some(Inline(VerificationKey))). Field 2 is an enterprise address: stake None.

Other on-chain types:
- `OutputReference` (payout tag) = `Constr0[bytes32 txid, Int index]`. Evolution `Data.constr(0n,[Data.bytearray(txid),Data.int(ix)])` → `d8799f5820…00ff` (checked locally). Masumi uses `mOutputReference(txHash, outputIndex)` (`MPS/packages/payment-source-v2/src/builders/withdrawal-outputs.ts:47-53`).
- Redeemer CBOR: Constr n → tag 121+n, e.g. SubmitResult `d87e80` (checked locally).

## 4. Redeemers (`Action`, `VP:75-94`; blueprint indices)

`Withdraw 0 | SetRefundRequested 1 | AuthorizeWithdrawal 2 | WithdrawRefund 3 | WithdrawDisputed{buyer_value, seller_value, admin_signatures} 4 | SubmitResult 5 | AuthorizeRefund 6`. The off-chain mapping is in `MPS/packages/payment-source-v2/src/builders/redeemer-data.ts:32-60` (`CollectCompleted`=0, `RequestRefund`=1, `CollectRefund`=3).

### Checks that apply to every redeemer (`VP:107-234`)
- The datum must be inline and parse. `collateral_return_lovelace >= 0`. `len(reference_signature) >= 16`.
- **Validity upper bound must be Finite** (`VP:139`), for all redeemers including Withdraw and WithdrawRefund. `current_time = upper bound`, and `cooldown_time = upper + cooldown_period` (`VP:139-142`).
- Script inputs at this address: their parseable datums must have distinct `reference_signature`. Unparseable ones are skipped (`VP:173-197`).
- **Every output at the script address** must have no reference script and an inline datum that parses as `Datum` (hard `expect`, `VP:199-209`). Their `reference_signature`s must be unique and ≥16 bytes (`VP:220-234`). So: never send change or dust to the escrow address in the same tx, and never put a ref script on it.
- Time helpers: `must_start_after(r, t)` = lower bound Finite and `t <= lower` (`VP:1129-1134`). `must_end_before(r, t)` = upper bound Finite and `upper < t` (strict; `VP:1177-1182`). `must_be_signed_by` = vkh ∈ `extra_signatories`, so **required signers must be set explicitly** (`VP:1125-1127`).
- The continuation output is located by `list.find` over script outputs whose datum satisfies every equality (`VP:357-386`, etc.). It must be at **exactly the same address** as the input (`VP:148,199-201`).

### SubmitResult (5), seller (`VP:643-700`)
- From: FundsLocked, ResultSubmitted, Disputed, RefundRequested. New state: FL/RS → **ResultSubmitted**, RR/D → **Disputed**.
- Signer: seller vkh. `lovelace(input) >= collateral_return_lovelace`.
- New datum: every field equal **except** `result_hash` (must be non-empty), `seller_cooldown_time >= upper + cooldown_period`, `buyer_cooldown_time == 0`, `state = new_state`.
- Value: `output >= input` for all assets (`assets.match(out, in, >=)`, `VP:769-771`).
- Time: `lower >= seller_cooldown_time`, AND (`upper < submit_result_time` OR (`upper < external_dispute_unlock_time` AND current `result_hash` non-empty)).

### Withdraw (0), seller collects (`VP:254-347`)
- From: **ResultSubmitted** with `lower >= unlock_time`, OR **WithdrawAuthorized** with no time gate. Current `result_hash` must be non-empty. It does **not** check seller_cooldown.
- Signer: seller vkh. No script output may carry the same `reference_signature` (terminal).
- `lovelace(input) >= collateral_return_lovelace`.
- Buyer collateral: the sum of outputs at `buyer_return_address ?? buyer` with inline datum == `own_ref` must have lovelace ≥ `collateral_return_lovelace`. This is required even when the return address is None.
- Seller: if `seller_return_address = Some(a)`, tagged outputs at `a` must hold ≥ `input.value − collateral_return_lovelace` (all assets). If None, there is no constraint: the seller's signature decides where the funds go.
- A tagged output must have address equality and a datum that soft-casts to `OutputReference` == `own_ref` (`VP:773-805`).

### SetRefundRequested (1), buyer (`VP:349-403`)
- From: FundsLocked, ResultSubmitted, Disputed. New state: `result_hash` empty → **RefundRequested**, otherwise **Disputed**.
- Signer: buyer vkh. Value preserved (≥).
- New datum: everything equal (including `result_hash`), `seller_cooldown_time == 0`, `buyer_cooldown_time >= upper + cooldown_period`.
- Time: `upper < unlock_time` AND `lower >= buyer_cooldown_time`.
- V2 has no UnSetRefundRequested; it cannot be undone (`MPS/.../state_machine_diagram.md:15-24`).

### WithdrawRefund (3), buyer reclaims (`VP:407-458`)
- From: FundsLocked, RefundRequested, RefundAuthorized. Current `result_hash` must be **empty**.
- Signer: buyer vkh. Terminal (no continuation with the same ref sig).
- Time: `lower >= submit_result_time`, **unless** the state is RefundAuthorized (no gate).
- If `buyer_return_address = Some(a)`, tagged outputs at `a` must hold ≥ the **full input value**. If None, it is unconstrained.
- So once a result is submitted, the buyer can only get funds back if the seller AuthorizeRefunds (which clears the hash) or the admins settle.

### AuthorizeRefund (6), seller (`VP:702-760`)
- From: FundsLocked, ResultSubmitted, RefundRequested, Disputed. Goes to **RefundAuthorized**.
- Signer: seller vkh. Value preserved.
- New datum: everything equal except `result_hash` **must become empty**, `seller_cooldown_time >= upper + cooldown_period`, `buyer_cooldown_time == 0`, `state = RefundAuthorized`.
- Time: `lower >= seller_cooldown_time` only. There is deliberately no upper deadline (`VP:703-718`).

### For reference only (not in our set)
- AuthorizeWithdrawal (2): buyer, Disputed → WithdrawAuthorized. Needs `lower >= buyer_cooldown`; new seller_cd=0, new buyer_cd ≥ upper+cd (`VP:460-502`).
- WithdrawDisputed (4): anyone, Disputed. Needs `lower >= external_dispute_unlock_time`, and weighted CIP-8 admin signatures over `blake2b_224(cbor(DisputeWithdrawal{own_ref, buyer_value, seller_value}))`. Any residual goes to the submitter (`VP:506-642`).

## 5. State diagram (`MPS/smart-contracts/payment-v2/state_machine_diagram.md:55-80`)

```
                 SubmitResult(S) [up<submit_result_time]          SubmitResult(S) (rotate hash)
  [lock] --> FundsLocked ------------------------------------> ResultSubmitted <-----+
              |  |  |                                            |   |   |  \________/
              |  |  +-- WithdrawRefund(B) [lo>=submit_result_time] --> [end]
              |  +----- AuthorizeRefund(S) ----------+           |   |   +-- Withdraw(S) [lo>=unlock_time] --> [end]
              |                                      v           |   +------ AuthorizeRefund(S) --+
              +-- SetRefundRequested(B) [up<unlock]  RefundAuthorized <-----------------------------+
                         |                           |  ^   +-- WithdrawRefund(B) (no time gate) --> [end]
                         v                           |  |
                   RefundRequested --AuthorizeRefund(S)-+  |
                     |   +-- WithdrawRefund(B) [lo>=submit_result_time] --> [end]
                     +-- SubmitResult(S) --> Disputed <-- SetRefundRequested(B) from ResultSubmitted [up<unlock]
                                               | Disputed->Disputed: SubmitResult(S) / SetRefundRequested(B)
                                               +-- AuthorizeRefund(S) --> RefundAuthorized
                                               +-- AuthorizeWithdrawal(B) --> WithdrawAuthorized --Withdraw(S)--> [end]
                                               +-- WithdrawDisputed(admins) [lo>=external_dispute_unlock_time] --> [end]
```
SubmitResult and AuthorizeRefund are not allowed from WithdrawAuthorized or RefundAuthorized (state_machine_diagram.md:144-147).

## 6. How payment-service builds each tx (the reference to port)

Library: **Mesh** `@meshsdk/core@1.9.0-beta.103` + `@meshsdk/core-cst@1.9.1`, pinned per V2 package (`MPS/packages/payment-source-v2/package.json`). CSL 15.0.3 is a root dep (`MPS/package.json:52`). There is no Lucid. The V1/V2 mesh pin split exists because the script-data hash and cost models must match (single-interaction.ts:1-15).

Builder: `MPS/packages/payment-source-v2/src/builders/single-interaction.ts`. Batch variants are in `batch-interaction.ts`.

**Continuation txs** (SubmitResult / RequestRefund / AuthorizeRefund): `generateMasumiSmartContractInteractionTransactionCustomFee` (single-interaction.ts:214-388)
1. `spendingPlutusScript('V3').txIn(escrow utxo).txInScript(script.code).txInRedeemerValue({alternative:n,fields:[]}, 'Mesh', exUnits).txInInlineDatumPresent()` (:329-340). The **script is attached inline** (no reference script).
2. Collateral: `txInCollateral(collateralUtxo)` + `setTotalCollateral('3000000')` (:347-359). The collateral UTxO is excluded from coin selection (:371-376).
3. Continuing output: `txOut(scriptAddr, sameAmounts (topped up to min-UTxO if needed)).txOutInlineDatumValue(newDatum)` (:278-326, 358-361).
4. `.invalidBefore(slot).invalidHereafter(slot).requiredSignerHash(wallet pkh).metadataValue(674,{msg:['Masumi', type]})` (:378-387). Fees: first build with default exUnits `{mem:7e6, steps:3e9}`, then `evaluateTx`, then rebuild with the measured budget (:167-211, 229-235).

**Terminal txs** (Withdraw=`CollectCompleted`, WithdrawRefund=`CollectRefund`): `generateMasumiSmartContractWithdrawTransactionCustomFee` (:515-635) uses the same input, collateral and signers. Outputs come from `addWithdrawalOutputs` (withdrawal-outputs.ts:29-83):
- main collection output tagged with the inline datum `OutputReference(own_ref)`, when `tagMainOutputAsOwnRef=true` (both services pass `true`);
- optional collateral-return output to the buyer, also tagged, emitted only if `lovelace > 0`;
- each output bumped to min-UTxO (:12-27).

Per-tx datum and window logic (services under `MPS/packages/payment-source-v2/src/services/`):

| tx | file | window | new datum |
|---|---|---|---|
| SubmitResult | `payments/submit-result/service.ts:272-288` | `constrainBeforeMs = seller_cooldown_time`. `constrainAfterMs = submit_result_time` if it is >5 min ahead, else `external_dispute_unlock_time` when a hash already exists, else a terminal error (:165-201) | `resultHash = new`, `seller_cd = newCooldownTime(cooldown, invalidAfterMs)`, `buyer_cd = 0`, state FL/RS→RS, RR/D→D, WA/RA→reject (:141-155) |
| Withdraw | `payments/collection/service.ts:198-282` | `constrainBeforeMs = WA ? seller_cd : max(seller_cd, unlock_time)` (:246-264). Only picks rows with `unlockTime <= now-10min` (:1217) | n/a. Seller gets `input − collateral` lovelace (:208-232) at `sellerReturnAddress ?? collectionAddress ?? wallet` (:236-241). Collateral goes to `buyerReturnAddress ?? buyer` (:271-280) |
| SetRefundRequested | `purchases/request-refund/service.ts:142-207` | `constrainAfterMs = unlock_time`, `constrainBeforeMs = buyer_cd` (:191-194). Only picks rows with `unlockTime > now+3min` (:1171) | copies **all** fields from the chain datum (incl. return addresses) (:146-166), `seller_cd=0`, `buyer_cd=newCooldownTime`, state RR if hash empty else Disputed |
| WithdrawRefund | `purchases/collect-refund/service.ts:170-211, 265-290` | `constrainBeforeMs = submit_result_time` unless RefundAuthorized (:183-202). Picks rows with `submitResultTime <= now-10min` (:1119) | n/a. Full UTxO value goes to `buyerReturnAddress ?? collectionAddress ?? wallet`. No collateral output (passes `null`) |
| AuthorizeRefund | `payments/authorize-refund/service.ts:170-189` | `constrainBeforeMs = seller_cd` only | `resultHash=null`→`""`, `seller_cd=newCooldownTime`, `buyer_cd=0`, state RefundAuthorized |

Datum construction: `getDatumV2` (contract-generator.ts:193-304) writes fields in schema order. Mesh string fields are hex bytes, nulls become `""` (:285-299). The Option and Address encoders are at :120-154: enterprise → stake `None`, base → Some(Inline). `createDatumFromDecodedContractV2` copies from the decoded on-chain datum (`datum-builder.ts:72-94`). The fields come from the blockchain identifier: `referenceKey`, `referenceSignature`, `sellerNonce` (first 64 hex when an agentIdentifier is appended), `buyerNonce`, `agentIdentifier` (datum-builder.ts:37-49). Identifier format: `LZString(sellerNonce+agentId . buyerNonce . refSig . refKey [. scriptAddr])` (`MPS/packages/payment-core/src/blockchain-identifier.ts:13-70`).

Window maths (`MPS/src/services/shared/tx-window.ts:18-129`):
- `invalidBefore = max(slot(now−5min)−1, slot(constrainBefore)+1)`;
- `invalidAfter = min(slot(now+5min)+30, slot(constrainAfter)−18)`; it throws if the window collapses.
- `invalidAfterMs = end of that slot`.
- Buffers come from `payment-core/src/config.ts:399-404`.
- `newCooldownTime = invalidAfterMs + cooldown + 1000` (`MPS/src/utils/converter/string-datum-convert/index.ts:436-451`).
- Result hash in the examples is the sha256 hex of the result text (`MPS/smart-contracts/payment-v2/submit-result-example.mjs:35-39`).

### Porting to Evolution (sketch; the API names below come from EVO source)
- `client.newTx().collectFrom({inputs:[escrowUtxo], redeemer: Data.constr(5n,[])})`. There is also a per-input or batch redeemer form (`EVO/sdk/builders/operations/Operations.ts:64-71`).
- `.attachScript({script: plutusV3})` (`TransactionBuilder.ts:919`). Use `.readFrom({referenceInputs})` if we deploy a ref script at a **non-escrow** address (`:996`).
- `.payToAddress({address: escrowAddr, assets: ≥input, datum: new InlineDatum.InlineDatum({data})})` (`Operations.ts:44-52`).
- `.addSigner({keyHash})` (`Operations.ts:453-456`).
- `.setValidity({from, to})`: unix ms as bigint (`Operations.ts:37-42`).
- `.build({changeAddress, setCollateral?})` (collateral return defaults to 5 ADA, `TransactionBuilder.ts:574`).
- x402 uses the same chain for the lock: `X402/dist/esm/index.mjs:432-446`.
- **Slot rounding:** Evolution converts ms → slot with floor division (`EVO/Time.ts:60-64`, used at `sdk/builders/internal/txBuilder.ts:850-855`). Ledger/Plutus then sees `lower = slotStart(fromSlot)` and `upper = slotStart(ttlSlot)` (1 s preprod slots, zeroTime 1655769600000: `EVO/SlotConfig.ts:49-52`).
  - For `must_start_after(T)`: pass `from = ceil(T/1000)*1000` (plus a margin) and wait until chain time ≥ from.
  - For `must_end_before(T)`: any `to < T` works.
  - For the cooldown field: write `>= to + 420000` (`slotStart(floor(to)) <= to`). Masumi's +1 s pad is fine.

## 7. x402 `masumi` datum encoding (what we read and write)

- `buildMasumiLockDatum` (`X402/dist/esm/chunk-MVYC4VJB.mjs:89-130`) builds `Data.constr(0n, [...19 fields])` in the exact `VP` order, with result_hash `""`, both cooldowns `0n`, state `Constr0[]`.
- Addresses (`:38-54`): `addressToData` → `Constr0[cred, stakeOpt]`; `cred` = `Constr(isScript?1:0,[bytes])`; base → `Some(Inline(cred))`; pointer → `Some(Pointer(slot,tx,cert))`; enterprise → `None`; Option address Some=0/None=1.
- Parser `parseMasumiLockDatum` (`:185-239`): requires Constr0 with 19 fields and returns hex/bigint fields plus `state` index. **Reuse it** to decode the escrow UTxO, but note it accepts any state index.
- Invariants x402 enforces at lock (`:326-364`):
  - state FL, empty hash, cooldowns 0;
  - no script or pointer creds;
  - refSig ≥ 16 bytes;
  - no party equals the escrow;
  - **buyer payout target ≠ seller payout target** (prevents the double-satisfaction case, `VP:274-287`);
  - deadline gaps hold.
- Lock value (`X402/dist/esm/index.mjs:170-215, 418-429`):
  - `collateral_return_lovelace` is a min-UTxO shortfall with a floor of `1435230` (`chunk-CSBFKQ5T.mjs:257,277-282`), solved as a fixed point.
  - The escrow holds `amount + collateral` lovelace, or `collateral` lovelace + the token for USDM.
  - The lock tx TTL is `payByTime`.
  - So **Withdraw must pay collateral back to `buyer_return_address ?? buyer`, tagged with own_ref**.
- Field provenance: `buyer` = paying wallet; `buyer_return_address` comes from `buyerInput` (usually None); seller, seller_return, nonces, agentId, inputHash and times come from the seller-signed `terms`; `referenceKey`/`referenceSignature` are the CIP-30 COSE key + COSE_Sign1 over the terms digest (`index.mjs:170-190`; `chunk-MVYC4VJB.mjs:277-301`).
- Deadlines: `payBy = now + maxTimeoutSeconds`; submitResult = payBy+15 min; unlock = payBy+35 min; externalDispute = payBy+55 min (`chunk-W6LS2M6Y.mjs:293-297, 415-427`).
- Minimum gaps: pay→submit ≥5 min, submit→unlock ≥15 min, unlock→dispute ≥15 min, horizon ≤30 days (`chunk-CSBFKQ5T.mjs:258-266`).
- Identifier (x402 flavour): 5 segments, sellerNonce = first 64 hex chars (`chunk-CSBFKQ5T.mjs:476-523`).
- Exported helpers we can import (checked with `Object.keys`): `parseMasumiLockDatum`, `buildMasumiLockDatum`, `masumiEscrowAddress`, `masumiEscrowScriptHash`, `MASUMI_DEFAULT_DEPLOYMENT`, `masumiMinUtxoLovelace`. The **applied script object itself is not exported**, so we rebuild it (§2).

## 8. Timing / cooldown rules (cheat sheet; times are POSIX ms; lo/up = tx validity bounds)

| tx | lower bound (lo) | upper bound (up) | cooldown writes |
|---|---|---|---|
| SubmitResult | ≥ seller_cd | < submit_result_time (or < ext_dispute if a hash already exists) | seller_cd ≥ up+420000; buyer_cd := 0 |
| Withdraw (RS) | ≥ unlock_time | finite, anything | n/a |
| Withdraw (WA) | none, but must be finite | finite | n/a |
| SetRefundRequested | ≥ buyer_cd | < unlock_time | buyer_cd ≥ up+420000; seller_cd := 0 |
| WithdrawRefund | ≥ submit_result_time (not needed if RA) | finite | n/a |
| AuthorizeRefund | ≥ seller_cd | finite, no deadline | seller_cd ≥ up+420000; buyer_cd := 0 |

- A cooldown only blocks the **same party** chaining actions within 7 min. The other party's next action resets it to 0.
- x402 defaults on the happy path: seller must SubmitResult before payBy+15 min (keep `up` a few slots earlier) and can Withdraw at ≥ payBy+35 min. The buyer can dispute until payBy+35 min, and can WithdrawRefund at ≥ payBy+15 min if no result was submitted.

## 9. Gotchas

1. **Required signer is mandatory.** `extra_signatories` must contain the buyer/seller **payment key hash from the datum**. A wallet signature alone is not enough; call `addSigner`. The datum principal is whatever address locked or was named, so a seller hot wallet must be the `terms.sellerAddress` key.
2. **Upper validity bound is always required** (`VP:139`). A tx with no TTL fails every redeemer.
3. **Continuation datum must re-encode identical structures.** Equality is on Plutus data, so an enterprise address must stay `None` stake and Some/None must be preserved. Decode from chain (as `request-refund/service.ts:146-151` does); never rebuild from the DB.
4. **The continuing output must be at the identical escrow address** (no stake part added) with no ref script. A second script-address output with a junk datum aborts the tx (`VP:827-836`).
5. **Tagged payout outputs:** inline datum `Constr0[txid, idx]` of the **spent escrow UTxO**, at `return_address ?? principal`. If `collateral_return_lovelace > 0`, the buyer-collateral output is needed even with no return address. The seller's main output is unconstrained when `seller_return_address` is None, but tagging it is harmless (collection/service.ts:373-375).
6. **Don't overpay the seller.** Pay `input − collateral` to the seller and `collateral` to the buyer. Both checks are `>=`, so overpaying silently funds the difference from the hot wallet (collection/service.ts:208-216).
7. **Min-UTxO:** the continuation datum grows (result hash +33 B, cooldown ints). Top up the continuing output; `>=` allows it (single-interaction.ts:278-326). x402 reserves headroom for this (`chunk-CSBFKQ5T.mjs:267-276`).
8. **Script size:** applied script ≈10 KB, attached inline each tx (Masumi does this). It fits in 16 KB, but a ref-script UTxO at another address is cheaper. It cannot be at the escrow address (`VP:204`).
9. **Cost models / script-data hash:** Masumi had `PPViewHashesDontMatch` with mismatched Mesh lines (single-interaction.ts:9-13, 119-125). With Evolution, use the provider's live protocol params and evaluate before submitting.
10. **WithdrawRefund needs an empty result_hash.** After SubmitResult, the buyer can't self-refund. The paths are seller AuthorizeRefund → WithdrawRefund, or a dispute that only Masumi admins can resolve on the default deployment (see Summary blocker).
11. **AuthorizeRefund from ResultSubmitted wipes result_hash.** Indexers must not treat a hash as permanent (state_machine_diagram.md:7-14).
12. **Deadline guards in the services:** Masumi refuses SubmitResult less than 5 min before the deadline (submit-result/service.ts:165-168). It only collects 10 min after unlock and only refunds 10 min after submit (collection:1217, collect-refund:1119). Copy these margins; the ±5 min window buffers otherwise collapse the window.
13. **Preview unsupported** by the default deployment. Use preprod (`cardano:preprod`).
14. **Never re-derive the address with a different Aiken/compiler or param encoding.** Admin key order matters. Verify `ScriptHash == a15ce9d8…14ad` at startup.
