# Applying parameters

Both validators are parameterised, so `plutus.json` holds unapplied code. Each campaign gets its own policy and its own bloc script:

1. `campaign` takes the seed `OutputReference` (a UTxO the bootstrap wallet will spend in the mint tx).
2. `bloc` takes the resulting campaign policy id.

`aiken blueprint apply` takes one parameter per call, as hex CBOR of Plutus Data. Run everything from `contracts/bloc/` after `aiken build`.

## Parameter encodings

| Parameter | Data | CBOR hex |
|---|---|---|
| `seed: OutputReference` | `Constr 0 [B tx_id(32), I index]` | `d8799f5820<tx_id hex>` + `<index>` + `ff` |
| `campaign_policy: PolicyId` | `B policy(28)` | `581c<policy hex>` |

The output index is a CBOR unsigned int: `00`..`17` for 0..23, `18xx` for 24..255, `19xxxx` for 256..65535. For example index 1 is `01` and index 30 is `181e`.

## Commands

```sh
cd contracts/bloc
aiken build

# 1. campaign policy for seed <TX_ID>#<INDEX>
TX_ID=5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e
INDEX_CBOR=01
aiken blueprint apply -m campaign -v campaign "d8799f5820${TX_ID}${INDEX_CBOR}ff" -o build/campaign.applied.json
POLICY=$(aiken blueprint policy -i build/campaign.applied.json -m campaign -v campaign)

# 2. bloc validator for that campaign (spend, withdraw and publish share this hash)
aiken blueprint apply -m bloc -v bloc "581c${POLICY}" -o build/bloc.applied.json
aiken blueprint hash    -i build/bloc.applied.json -m bloc -v bloc
aiken blueprint address -i build/bloc.applied.json -m bloc -v bloc     # testnet (preprod) by default
```

With the example seed above the outputs are:

| Value | Result |
|---|---|
| campaign policy id | `1d23a9ce3f5a1a9aaf2443b86d5fb1b098ccd905caf1d312bc58ac5c` |
| bloc script hash | `2a4bef1c1c9bc57ddce13fde0e4a31964e28946315bd3743c417f902` |
| bloc address (preprod) | `addr_test1wq4yhmcurjdu2lwuuylaurj2xxtyu2y5vv2m6d6rcstljqs805eg4` |

These are stored in `packages/bloc-contract/test/apply-vectors.json`. The vitest suite recomputes them with Evolution (`UPLC.applyParamsToScript`) and also runs the commands above live when `aiken` is on the PATH, comparing code bytes, hashes and the address. Re-run and update the vector file whenever the contract changes.

## Same thing in TypeScript

```ts
import { campaignPolicy, blocScript, blocAddress } from "@overpaid/bloc-contract";
const policy = campaignPolicy({ txHash, index });   // { hash, script, compiledCode }
const bloc = blocScript(policy.hash);               // same hash for spend / withdraw / publish
const address = blocAddress(bloc.hash, 0);          // pledges and the campaign UTxO go here
```

## Bootstrap order

1. Pick the seed UTxO, derive the policy id and the bloc hash (offline, as above).
2. Mint the campaign NFT (asset name = `bloc_id`) spending the seed. Send it to the bloc address with the inline campaign datum. There it can never be spent or burned, so the datum is immutable and refunds always find it.
3. Register the bloc stake credential: Conway `RegCert` (deposit = `keyDeposit`, 2 tADA on preprod) with a publish redeemer (any Data). Evolution: `registerStake({ stakeCredential: blocStakeCredential(hash), redeemer: publishRedeemer })`. The credential can never be deregistered (the publish handler only accepts registration), so the deposit is spent for good.
4. Optionally publish the applied bloc script as a reference script UTxO (about 2 KB) so settlements stay small.
