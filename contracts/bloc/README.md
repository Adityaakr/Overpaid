# Bloc contract (Aiken, Plutus V3)

Group buying on Cardano preprod. Members lock refundable pledges, providers sign bids off chain, and one settlement transaction pays the winning provider and refunds every member the difference. If nothing settles, anyone can return each pledge after the refund deadline.

Toolchain: Aiken `v1.1.24`, stdlib `v4.0.0`, fuzz `v3.0.0`, Plutus V3 (pinned in `aiken.toml`, locked in `aiken.lock`).

```sh
aiken check   # 90 tests (83 unit incl. 8 ctx dumps, 7 property x 100 runs)
aiken build   # writes plutus.json (silent traces)
```

## Files

| Path | What it is |
|---|---|
| `validators/campaign.ak` | One-shot campaign NFT policy, parameterised by a seed `OutputReference` |
| `validators/bloc.ak` | The bloc validator: `spend`, `withdraw`, `publish`, `else` in one script |
| `validators/bloc_test.ak` | All tests, plus `ctx_nN` context dumps used for cost measurement |
| `lib/bloc/types.ak` | Datums and redeemers (field order is the on-chain encoding) |
| `lib/bloc/message.ak` | The fixed-layout bid message and the length-checked signature check |
| `lib/bloc/checks.ak` | Campaign lookup, value coverage, "holds no campaign token" |
| `lib/vendor/design_patterns.ak` | Withdraw-zero and multi-UTxO indexer helpers vendored from Anastasia Labs (MIT, see `LICENSE-aiken-design-patterns`) |
| `scripts/apply-params.md` | Exact `aiken blueprint apply` commands and the bootstrap order |
| `../../packages/bloc-contract` | TypeScript mirror: params, hashes, addresses, Data encoders, bid signing, cost measurement |

## Design decisions

**One validator, no hash cycle.** A separate pledge script would need the settle script's hash and the settle script would need the pledge script's hash. Instead `bloc` has `spend`, `withdraw` and `publish` handlers in one validator, so they share one hash. The spend handler finds its own hash from its own input and requires a withdrawal of that same credential.

**Parameterised by the campaign policy id.** The settle and refund logic must trust the campaign reference input (allowlist, deadlines, asset). Anyone can write a datum, so the only trustworthy anchor is the one-shot NFT, and the script has to know which policy that is. Reading the policy from the pledge datum would let an attacker point at their own fake campaign with their own key in the allowlist. A parameter fixes it, at the cost of one script, address and stake registration (2 tADA) per campaign. The campaign policy is derived from the seed only, so there is no cycle: seed, then policy, then bloc hash.

**Where the campaign lives.** Send the campaign NFT to the bloc address itself. Both spend paths reject any input holding a campaign-policy token, so the campaign UTxO is locked forever: its datum is immutable and the NFT can't be burned, which keeps refunds possible. The mint policy checks the datum when minting: `bloc_id` equals the token name (at most 32 bytes), `min_batch >= 1`, `members_limit >= min_batch`, `bid_deadline < refund_deadline`, a non-empty allowlist of 32-byte keys, and an asset that is either a token or exactly ADA. Burning is allowed by the policy, but it's impossible while the NFT is locked at the bloc address.

**Output index conventions (settle).**
- Output `#0` pays the provider: address equal to `bid.provider_address`, at least `unit_price x sum(quantity)` of the asset, and an inline datum equal to the campaign policy id bytes. The tag stops two campaigns' settlements in one transaction from sharing one provider output.
- Outputs `#1..` are refunds, one per pledge, in the same order as the pledge inputs. The `pairs` redeemer lists `(input index, output index)` with both strictly increasing, and output index `0` can never be paired.
- The change output goes after the refunds.

**Double satisfaction.** Every refund output (settle or refund path) carries an inline datum equal to the pledge's own `OutputReference`. That is unique per pledge, so one output can't satisfy two pledges, even for the same member. The indexer also forces a bijection between script inputs and outputs.

**Stray UTxOs at the script address.**
- A UTxO without a parseable inline `PledgeDatum` (no datum, a datum hash, or the wrong shape) can never be spent by anyone. Settle needs a valid datum for every script input, and Refund needs one too. Nobody can steal it, but it is stuck for good, so off-chain code must only pay to the address with a validated datum.
- Strays don't block settlement. The indexer walks only the inputs actually in the transaction, and the settlement builder doesn't include them.
- A pledge with a valid datum that is unfunded, for another bloc, or priced below the bid makes any settlement including it fail. The builder skips it, and it can still be refunded after the deadline to the address in its own datum. Refunds don't require a matching `bloc_id`, so a mistaken pledge isn't stuck.
- Any UTxO holding a campaign-policy token is unspendable.

**Publish.** Only `RegisterCredential` is accepted. The ledger runs this handler only for certificates on our own credential. Deregistration is refused: otherwise anyone could pocket the deposit and stall settlement until someone re-registered. Delegation is refused too.

**Time.** Times are POSIX milliseconds. Settle needs a finite upper bound with `is_entirely_before(min(bid.expiry, bid_deadline))`, so set `validTo` at or before that instant (the upper bound is exclusive). Refund needs a finite lower bound strictly after `refund_deadline`, so set `validFrom > refund_deadline`.

**Not enforced on chain:** `members_limit`, atomicity across batches, and provider registration on Masumi (checked off chain).

## Records

All of these are `Constr 0 [fields...]` in this order unless noted.

| Record | Fields |
|---|---|
| `Asset` | `policy: ByteArray`, `name: ByteArray` (ADA is `"" / ""`) |
| `CampaignDatum` | `bloc_id`, `item_hash`, `asset: Asset`, `members_limit`, `min_batch`, `bid_deadline`, `refund_deadline`, `provider_vkeys: List<ByteArray(32)>` |
| `PledgeDatum` | `bloc_id`, `member_refund_address: Address`, `quantity`, `max_unit_price` |
| `Bid` | `bloc_id`, `item_hash`, `asset: Asset`, `unit_price`, `expiry`, `provider_vkey: ByteArray(32)`, `provider_address: Address` |
| withdraw redeemer `SettleRedeemer` | `bid: Bid`, `signature: ByteArray(64)`, `pairs: Pairs<Int, Int>` (a Data **map** in order) |
| spend redeemer `Settle` | `Constr 0 [input_index, withdrawal_index]` |
| spend redeemer `Refund` | `Constr 1 [input_index, output_index]` |
| refund output datum | the pledge's `OutputReference` = `Constr 0 [tx_id, index]` |
| provider output datum | `B campaign_policy` |

`Address` is the standard Plutus V3 encoding: `Constr 0 [credential, stake]`. Here `credential` is `Constr 0 [vkh]` for a key or `Constr 1 [script hash]` for a script, and `stake` is `Constr 1 []` for none or `Constr 0 [Constr 0 [credential]]` for an inline key or script. `input_index` is the pledge's position in the sorted transaction inputs, and `withdrawal_index` its position in the sorted withdrawals (normally 0).

A pledge is funded when it holds `quantity_of(asset) >= max_unit_price x quantity`. At settlement it must also have `max_unit_price >= unit_price` and `quantity > 0`. Its refund output must hold at least everything the pledge held (all lovelace, min-ADA included, and any other token), minus `unit_price x quantity` of the asset.

## Bid message layout

Providers sign the raw bytes below with ed25519 (no pre-hash). On chain the key length (32) and signature length (64) are checked before `verify_ed25519_signature`, which would otherwise abort the script.

| # | Field | Encoding | Bytes |
|---|---|---|---|
| 1 | magic | ASCII `BLOCBID1` (`424c4f4342494431`) | 8 |
| 2 | campaign policy id (the script parameter) | raw | 28 |
| 3 | `bloc_id` | u8 length, then bytes | 1 + n |
| 4 | `item_hash` | u8 length, then bytes | 1 + n |
| 5 | `asset.policy` | u8 length, then bytes (0 for ADA) | 1 + 0 or 28 |
| 6 | `asset.name` | u8 length, then bytes | 1 + 0..32 |
| 7 | `unit_price` | unsigned 64-bit big endian | 8 |
| 8 | `expiry` (POSIX ms) | unsigned 64-bit big endian | 8 |
| 9 | `provider_vkey` | raw | 32 |
| 10 | `provider_address` payment | tag `00` key or `01` script, then 28-byte hash | 29 |
| 11 | `provider_address` stake | `00` none, or `01` key / `02` script then 28-byte hash | 1 or 29 |

Pointer stake addresses, negative or 2^64+ integers, fields over 255 bytes and hashes other than 28 bytes are rejected on both sides. Field 2 binds a bid to one campaign even if two campaigns reuse a `bloc_id`.

Test vector (from `packages/bloc-contract/test/fixtures.ts`, secret key `0x01 x 32`, campaign policy `c0 x 28`, `bloc_id` = "esim-eu-30d", 4 USDM unit price, base address provider). The message is 221 bytes:

```
424c4f4342494431 c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0
0b 6573696d2d65752d333064
20 ada43fa140bc8667cf4162fbbc0b9b57109c2a7d7f4773949b369e533aa4b4dd
1c a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5
04 5553444d
00000000003d0900 000001a3185c5000
8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c
00 b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1
01 b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2
signature: 6d6bd112a0e4269234fd1eb8436348aa8ef158be43e4ccc448185b83345b19da30cc690d9c2be068b5fbc1300d7b2c0b1c4f972d013ff16d35ff13f66081dc05
```

## Building transactions

**Settle** (anyone holding a signed bid can build it; the coordinator normally does):
- reference inputs: the campaign UTxO, plus the bloc reference script if published;
- inputs: the chosen pledges, each with spend redeemer `Settle { input_index, withdrawal_index: 0 }`, plus fee inputs. Use Evolution's per-input (Self) redeemer to get final sorted indices;
- withdrawal of 0 lovelace from the bloc script credential, with the `SettleRedeemer` built after coin selection (Batch redeemer, so `pairs` uses final input indices);
- outputs: `#0` provider, `#1..#N` refunds in pledge input order, then change;
- `validTo` no later than `min(bid.expiry, bid_deadline)`;
- at least `min_batch` pledges.

**Refund** (anyone, after the deadline): `validFrom > refund_deadline`, the campaign UTxO as a reference input, and for each pledge the spend redeemer `Refund { input_index, output_index }` with an output to `member_refund_address` holding the whole pledge value and the pledge's out-ref inline datum. The builder pays the fee.

## Measured cost

Real on-chain units, measured by `pnpm --filter @overpaid/bloc-contract measure`. That script evaluates the applied, silent-trace script with `aiken uplc eval` on full V3 script contexts dumped by the `ctx_nN` tests: 1 withdraw plus N pledge spends, each pledge holding ADA and USDM, with base refund addresses.

| N | withdraw mem / cpu | N spends mem / cpu | total mem (of 17.5M) | total cpu (of 10B) |
|---|---|---|---|---|
| 1 | 0.48M / 0.22B | 0.08M / 0.03B | 0.55M (3.2%) | 0.25B (2.5%) |
| 5 | 1.15M / 0.46B | 0.41M / 0.14B | 1.56M (8.9%) | 0.60B (6.0%) |
| 10 | 2.00M / 0.74B | 0.90M / 0.31B | 2.89M (16.5%) | 1.05B (10.5%) |
| 20 | 3.68M / 1.32B | 2.09M / 0.71B | 5.77M (33.0%) | 2.03B (20.3%) |
| 30 | 5.37M / 1.90B | 3.56M / 1.19B | 8.93M (51.0%) | 3.09B (30.9%) |
| 40 | 7.06M / 2.48B | 5.32M / 1.77B | 12.38M (70.7%) | 4.25B (42.5%) |
| 50 | 8.75M / 3.06B | 7.36M / 2.44B | 16.11M (92.1%) | 5.49B (54.9%) |

Memory is the binding limit. The withdraw grows linearly, at about 0.17M mem per pledge. Each spend locates itself with `list.at(tx.inputs, input_index)`, so the spends grow slightly faster than linearly. `N_max = 40` leaves about 30% headroom. Confirm it on Yaci or preprod with `scripts/capacity.ts`: real transactions add fee inputs, and the transaction size limit (16384 bytes) also applies.

## Off-chain caveat

Evolution's `CBOR.AIKEN_DEFAULT_OPTIONS` encodes Data maps as arrays of pairs, which turns the `pairs` map into a list. Never serialise redeemers with it. `@overpaid/bloc-contract` exports `AIKEN_CBOR` (byte-identical to Aiken's `cbor.serialise`) for vectors and hashes. Parameter application is unaffected because none of the parameters contains a map.

## Credits

`lib/vendor/design_patterns.ak` adapts `stake_validator.validate_withdraw_minimal` and `multi_utxo_indexer.one_to_one_no_redeemer` from [Anastasia-Labs/aiken-design-patterns](https://github.com/Anastasia-Labs/aiken-design-patterns) v1.9.0 (commit `0594253c`), MIT licensed. The adaptation threads an accumulator, reserves output `#0` and walks outputs incrementally.
