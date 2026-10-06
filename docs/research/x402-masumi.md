# x402 `masumi`-method escrow hire on Cardano preprod: research notes

Sources read (shallow clone, commit `6481c9a`, 2026-10-01):
`REF=/private/tmp/claude-501/-Users-adityakrx-ombud/db8e4563-317e-4dd6-87ae-2ab7bdf7790a/scratchpad/refs/x402-cardano-demo`
npm tarballs: `.../scratchpad/refs/npm/{_x402_cardano_2.26.0,_x402_cardano_2.28.0,_x402_core_2.26.0,ex}` (ex = @x402/express 2.26.0).
Paths below: `masumi/src/...` and `frontend/src/...` are in REF; `cardano:` is `@x402/cardano@2.26.0/dist/esm/`; `core:` is `@x402/core@2.26.0/dist/esm/`.

## Summary

1. The seller is a plain Express app. `@x402/express` `paymentMiddlewareFromHTTPServer` gates `POST /x402/start_job`, and `@x402/cardano/exact/server` `ExactCardanoScheme({ masumi: { seller, agentIdentifier?, commitment } })` turns a route *template* (`payTo = masumiEscrowAddress`, `extra.assetTransferMethod: "masumi"`) into a fresh seller-signed quote on every 402 (masumi/src/agent.ts:102-134).
2. The buyer signs a tx that locks funds at Masumi's shared `vested_pay` V2 escrow, `addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g`, with a 19-field inline datum. It never broadcasts. The facilitator verifies and broadcasts the tx (`settle`).
3. The facilitator can run in-process, with no keys: `new x402Facilitator().register(NETWORK, new FacilitatorScheme(toFacilitatorCardanoSigner({...blockfrost, awaitConfirmation:false}), { validateRegistryClaim }))` (agent.ts:88-97).
4. The express route handler runs **after verify and before settle**, so it must not touch the chain. A watcher loop (every 10 s) finds the lock by tx hash, checks every datum field, runs the job, and submits `SubmitResult` (redeemer `Constr 5 []`) (agent.ts:142-249).
5. The seller writes these txs itself with Evolution SDK: SubmitResult, Withdraw (collect, redeemer `Constr 0 []`), registry mint and burn (masumi/src/chain.ts:203-327). `@x402/cardano` only covers the lock and verify half.
6. Default x402 deadlines: payBy = now + maxTimeoutSeconds. After payBy: submitResult +15 min, unlock +35 min, dispute +55 min. Preprod cooldown is 420 000 ms.
7. Registration is optional. An unregistered seller (no `agentIdentifier`) skips every registry check. The demo's tADA offer works that way (agent.ts:139).
8. A Node buyer can use the reference signer `toClientCardanoSigner({ mnemonic, network, provider })`. It handles `masumi`: it verifies the seller authorization, calls `buildMasumiLock`, and sets TTL = payByTime (cardano:index.mjs:300-420).
9. `@x402/cardano` 2.28.0 (latest) has the same ESM `dist` and d.ts as 2.26.0. Only the version and the `@x402/core ~2.28.0` dependency changed.
10. License: the demo repo has **no LICENSE file** and GitHub reports `license: null`, so legally it is all rights reserved. The `@x402/*` packages are Apache-2.0. The vendored Masumi contracts are MIT (NMKR).

## Versions

| Package | Demo pin | Latest | Notes |
|---|---|---|---|
| `@x402/cardano` | 2.26.0 (masumi/package.json) | 2.28.0 | Apache-2.0; deps `@x402/core ~X`, `@evolution-sdk/evolution ^0.5.9`, `lz-string`, `@noble/hashes` |
| `@x402/core` | 2.26.0 | 2.28.0 | Apache-2.0 |
| `@x402/express` | 2.26.0 | 2.28.0 | |
| `@evolution-sdk/evolution` | **0.5.13** (masumi/package.json, both lockfiles) | 0.5.17 | frontend uses `^0.5.9` |
| others (masumi) | express 4.22.3, dotenv 16.6.1, canonical-json 0.2.0, lz-string 1.5.0, @noble/hashes 2.4.0, tsx 4.23.1, TS 5.9.3; Node >= 22 | | canonical-json and lz-string are needed only for the standard MIP-003 path |

Keep `@x402/cardano` and `@x402/core` on the same minor version, because cardano pins core with `~`.

## Seller flow (step by step)

**0. Config.** `toMasumiSellerSigner({ network: "cardano:preprod", mnemonic })` returns `{ sellerAddress, signTerms }` (masumi/src/config.ts:23-27). `NETWORK = "cardano:preprod"` and `ESCROW_ADDRESS = masumiEscrowAddress(NETWORK)` (constants.ts:8-10).

**1. Issuer per offer** (agent.ts:102-134):
```ts
const server = new x402ResourceServer(facilitatorClient).register(NETWORK, new ServerScheme({ masumi: {
  seller: seller.signer,                         // MasumiSellerSigner
  ...(claim ? { agentIdentifier: claim } : {}),  // omit => unregistered
  commitment: ({ transportContext }) => [{ name: "body", canonicalization: "jcs",
      mediaType: "application/json", content: parsedBody }],  // binds input_hash to the job body
}}));
const http = new x402HTTPResourceServer(server, { [`POST ${path}`]: {
  resource: `${publicUrl}${path}`,
  accepts: { scheme: "exact", network: NETWORK, payTo: ESCROW_ADDRESS, maxTimeoutSeconds: 300,
             price: { amount, asset },            // asset "lovelace" or "policy.assetHex"
             extra: { assetTransferMethod: "masumi", areFeesSponsored: false } },
  description, mimeType: "application/json" }});
```
- The commitment hook reads the body through `(transportContext as HTTPTransportContext).request.adapter.getBody?.()` (agent.ts:110).
- `onVerifyFailure` and `onSettleFailure` hooks log errors (agent.ts:115-116).
- Before listening, call `await server.initialize(); await http.initialize()` (agent.ts:351-354).

**2. Facilitator client.** The demo wraps the in-process `x402Facilitator` as a `FacilitatorClient` `{verify, settle, getSupported}` (agent.ts:93-97). To use a hosted facilitator instead, pass `new HTTPFacilitatorClient({ url })` (DEVELOPER.md §4).

**3. Route.** It runs body validation, then a busy check, then `paymentMiddlewareFromHTTPServer(offer.http, undefined, undefined, false)`, then the handler (agent.ts:317-322).
- With no `PAYMENT-SIGNATURE` header, the route answers `402` with a base64 `PAYMENT-REQUIRED` header and body `{}`.
- With the header, the middleware runs verify, then the handler, then settle, and only then sends `200` with a `PAYMENT-RESPONSE` header (FLOWS.md §3.5).

**4. Handler `x402Job`** (agent.ts:147-179):
- Decode the payment: `decodePaymentSignatureHeader(req.get("PAYMENT-SIGNATURE"))` gives the payment, then `decodeCardanoTransaction(payment.payload.transaction).txHash` gives the tx hash.
- Read the terms from `payment.accepted.extra as CardanoExtraMasumi`: `terms`, `referenceKey`, `referenceSignature`, `blockchainIdentifier`, `inputCommitment.parts[0].content` (the paid job input, *not* req.body).
- Store an `expected` lock record keyed by txHash. Make it idempotent for retries of the same tx.

**5. Watcher** (agent.ts:198-266). It runs every 10 s and is serialised.
- For each job in `awaiting_payment`, call `chain.locksOfTx(txHash)`. This uses Blockfrost `/txs/{hash}/utxos`, keeps unspent non-collateral outputs at the escrow, then calls `client.getUtxosByOutRef` (chain.ts:117-188).
- `lockMismatch` checks every seller-decided datum field against the signed terms. These must hold: `seller_return_address None`, `result_hash ""`, cooldowns 0, `state 0`, `collateral_return_lovelace <= lovelace`, and the payment must not be underpaid (lockMatch.ts:51-83).
- The job fails if the lock is not seen by `payBy + 5 min`, or if `now > submitResultTime - 5 min` (agent.ts:187-239).
- Run the task, then compute `resultHash = sha256(identifier_from_purchaser + ";" + output)` (MIP-004, masumi.ts:91).

**6. SubmitResult** (chain.ts:248-274):
- The tx spends the lock with redeemer `Data.constr(5n, [])` and `attachScript(paymentScript())`. `paymentScript()` takes the vendored `payment-v2.plutus.json` and applies `(requiredAdmins, adminVkeys, cooldownPeriod)` from `MASUMI_DEFAULT_DEPLOYMENT` through `UPLC.applyParamsToScript`, then unwraps the double CBOR (chain.ts:39-49).
- It has one output back to `utxo.address` with the same `assets` and `autoMinUtxo: true`. The datum is `submitResultDatum` (masumi.ts:200-208): field 11 = result hash, field 16 = sellerCooldown, field 17 = 0, field 18 = `Constr 1 []`.
- `addSigner(sellerVkh)`, `setValidity({from, to})`:
  - `from = max(tip - 60 s, ceilToSlot(d.sellerCooldownTime))`
  - `to = min(tip + 300 s, submitResultTime - 120 s)`
  - `sellerCooldown = slotStart(to) + 420 000`
- Chain time comes from Blockfrost `/blocks/latest` (chain.ts:155-159).

**7. Collect** (`npm run collect`, scripts/collect.ts, chain.ts:287-327):
- Scan *all* UTxOs at the escrow. Keep only those with state 1, this seller, a non-empty result, and `now >= ceilToSlot(unlockTime)`.
- Spend **one escrow per tx** with redeemer `Constr 0 []`, `from = ceilToSlot(unlockTime)`, `to = now + 300 s`.
- If `collateralReturnLovelace > 0`, pay it to `buyerReturnAddress ?? buyer`, with inline datum `Constr 0 [txHashBytes, index]` (the spent OutputReference).
- Everything else goes to the seller as change. No output may go back to the escrow.

**8. Seller-tx plumbing** (chain.ts:134-170):
- Txs run one at a time in a `serial` queue.
- `checkWallet()` checks that the mnemonic derives the expected seller address. It also filters the registry NFT and reference-script UTxOs out of coin selection.
- `signSubmitAwait` calls `built.sign()`, then `.submit()`, then `client.awaitTx(hash, 5_000, 300_000)`.

**MIP-003 surface** (agent.ts:278-344):

| Route | Purpose |
|---|---|
| `GET /availability` | returns `{status:"available", type:"masumi-agent", agentIdentifier, message}` |
| `GET /input_schema` | returns `{input_data:[{id,type,name,data,validations}]}` |
| `POST /start_job` | standard path: signs Payment-Service-style terms (masumi.ts:133-187), no x402 |
| `GET /status?job_id=` | job status |
| `GET /jobs/:id`, `GET /jobs/by-tx/:hash`, `GET /demo/config` | demo extras |

Job body: `{ identifier_from_purchaser: 14-64 lowercase even-length hex, input_data: {...} }` (agent.ts:62-69).

## Buyer flow (exact shapes from source)

Browser version (frontend/src/masumi/x402Flow.ts:79-181, cip30Signer.ts:21-106):
```ts
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { x402Client, x402HTTPClient } from "@x402/core/client";
const body = { identifier_from_purchaser: randomHex(10), input_data: { text } };
const first = await fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) }); // expect 402
const http = new x402HTTPClient(x402Client.fromConfig({
  schemes: [{ network: "cardano:preprod", client: new ExactCardanoScheme(signer) }],
  spendControls: { allowedAssets: [{ network: NETWORK, asset: offer.asset, maxAmountPerPayment: offer.amount }] }, // lovelace / Masumi tUSDM are not defaults
  policies: [(_v, offers) => offers.filter(o => o.extra?.assetTransferMethod === "masumi" && o.amount === offer.amount)],
}));
const required = http.getPaymentRequiredResponse(n => first.headers.get(n));   // PaymentRequired (has .resource)
const payload  = await http.createPaymentPayload(required);                     // calls signer.buildAndSignPaymentTransaction
const txHash   = decodeCardanoTransaction(String(payload.payload.transaction)).txHash; // known before broadcast
const paid = await fetch(url, { ...init, headers: { ...init.headers, ...http.encodePaymentSignatureHeader(payload) } });
const receipt = http.getPaymentSettleResponse(n => paid.headers.get(n));        // {success, transaction, network, payer}
// then poll GET /jobs/by-tx/<txHash> every 5 s until status completed|failed
```
The custom CIP-30 signer (cip30Signer.ts:32-105) does the following:
- `validateMasumiExtra(extra, network)`.
- `verifyMasumiAuthorization(masumi, reqs, { requireAllPartContent: true, validateRegistryClaim, resource })`.
- **It checks itself that `parts[0].content` deep-equals the body it sent.**
- Nonce input = `utxos[0]`. Fetch `coins_per_utxo_size` from Blockfrost `/epochs/latest/parameters`.
- `buildMasumiLock(masumi, buyerBech32, asset, BigInt(amount), coinsPerUtxo)` returns `{datum, lockedLovelace, collateralLovelace}`.
- `newTx().collectFrom({inputs:[nonce]}).payToAddress({address: payTo, assets: lockedLovelace (+token), datum: lock.datum}).setValidity({ to: BigInt(terms.payByTime) }).build({ changeAddress, availableUtxos, autoMinUtxo: false })`.
- Sign, then return `{ transaction: base64(CBOR), nonce: "txhash#ix" }`.

**Node buyer (what we will use).** The reference signer handles masumi end to end (cardano:index.mjs:300-420):
```ts
import { toClientCardanoSigner } from "@x402/cardano";
const signer = toClientCardanoSigner({ mnemonic, network: "cardano:preprod",
  provider: { blockfrost: { baseUrl, projectId } },
  // optional: validateMasumiRegistryClaim, masumiBuyerInput: () => ({buyerReturnAddress}),
  //           masumiMaxCollateralLovelace (default 15 ADA), masumiMaxDeadlineHorizonMs (default 30 d)
});
```
Internally, for `extra.assetTransferMethod === "masumi"`, it does the following:
- `validateMasumiExtra`, then `verifyMasumiAuthorization(... requireAllPartContent:true, resource: input.resource ...)`, then `assertMasumiPaymentWindow`.
- `getProtocolParameters().coinsPerUtxoByte`, then `buildMasumiLock`, then a datum-invariant preflight and a collateral cap check.
- Build the tx with TTL `terms.payByTime`.

### Exact signatures (d.ts, 2.26.0 = 2.28.0)

| What | Signature | Source |
|---|---|---|
| Client scheme | `class ExactCardanoScheme { constructor(signer: ClientCardanoSigner); createPaymentPayload(x402Version, reqs, ctx?) }` | cardano:exact/client/index.d.mts:15-37 |
| Client signer | `interface ClientCardanoSigner { getAddress(): string; buildAndSignPaymentTransaction(input: ClientCardanoSignInput): Promise<{transaction: string /*b64 CBOR*/; nonce: string /*"hash#ix"*/}> }` | cardano:signer-B0QJ0K4F.d.mts:230-296 |
| Sign input | `{ network, payTo, asset, amount, maxTimeoutSeconds, extra?, resource? }` | same, :251-283 |
| Lock builder | `buildMasumiLock(extra: CardanoExtraMasumi, buyerAddress, asset, amount: bigint, coinsPerUtxoByte: bigint, buyerInput?): { datum: InlineDatum; collateralLovelace; lockedLovelace }` | same, :48 |
| Buyer auth check | `verifyMasumiAuthorization(extra, requirements, { validateRegistryClaim?, resource?, requireAllPartContent?, ... }) => {ok:true, escrowAddress, termsDigest} \| {ok:false, reason, detail?}` | same, :165 |
| Seller signer | `toMasumiSellerSigner({ mnemonic, network, accountIndex? }): { sellerAddress; signTerms(addr, digestHex) => {key, signature} }` | cardano:masumiIssuer-DkUhszBl.d.mts:118-125 |
| Server scheme | `new ExactCardanoScheme({ masumi?: MasumiIssuerConfig; masumiStorage?: MasumiTermsStorage })` | cardano:exact/server/index.d.mts:7-73 |
| Issuer config | `{ seller; sellerReturnAddress?; agentIdentifier?; deployment?; commitment?(ctx) => MasumiCommitmentInput[]; deadlines?: {submitResultAfterPayByMs, unlockAfterPayByMs, externalDisputeUnlockAfterPayByMs}; maxDeadlineHorizonMs?; paymentPayloadFromTransport? }` | masumiIssuer d.ts:252-284 |
| Manual issue | `issueMasumiRequirements(IssueMasumiRequirementsInput): Promise<PaymentRequirements>` | masumiIssuer d.ts:45-105 |
| Facilitator scheme | `new ExactCardanoScheme(signer: FacilitatorCardanoSigner, { settlementStore?, acceptMempool?, confirmationTimeoutMs? (75 s), confirmationPollMs?, validateRegistryClaim?, validateCustomMasumiDeployment? })`; `verify(payload, reqs)`; `settle(payload, reqs)` | cardano:exact/facilitator/index.d.mts:11-144 |
| Facilitator signer | `toFacilitatorCardanoSigner({ network, provider, mnemonic?, accountIndex?, awaitConfirmation?, validatePhase1Transaction? })` | signer d.ts:575-643 |
| Core client | `x402Client.fromConfig({ schemes: [{network, client}], policies?, spendControls?, paymentRequirementsSelector? })`; `.register(network, client)`; `new x402HTTPClient(client)` with `getPaymentRequiredResponse(getHeader, body?)`, `createPaymentPayload(pr)`, `encodePaymentSignatureHeader(p): Record<string,string>`, `getPaymentSettleResponse(getHeader)` | core:x402Client-CNluJCIi.d.mts:1936-1989; core:client/index.d.mts:37-95 |
| Core server | `new x402ResourceServer(facilitatorClients?)`, `.register(network, scheme)`, `.initialize()`, hooks `onAfterVerify` / `onVerifyFailure` / `onSettleFailure`; `new x402HTTPResourceServer(server, routes)`, `.initialize()` | core x402Client d.ts |
| Core facilitator | `new x402Facilitator().register(networks, scheme)`; `.verify(payload, reqs)`, `.settle(payload, reqs)`, `.getSupported()`; `HTTPFacilitatorClient({url})` | core:facilitator/index.d.mts |
| HTTP helpers | `decodePaymentSignatureHeader(s)`, `encodePaymentSignatureHeader(p): string`, `decodePaymentRequiredHeader(s)`, `decodePaymentResponseHeader(s)` | core:http/index.d.mts:14-49 |
| Express | `paymentMiddlewareFromHTTPServer(httpServer, paywallConfig?, paywall?, syncFacilitatorOnStart?)`; `paymentMiddleware(routes, server, ...)`; `paymentMiddlewareFromConfig(routes, facilitatorClients?, schemes?, ...)` | ex:dist/esm/index.d.mts:122-174 |
| Misc exports | `masumiEscrowAddress(network, deployment?)`, `MASUMI_DEFAULT_DEPLOYMENT`, `MASUMI_REGISTRY_POLICY_ID = 67ab0c92…bd0b`, `parseMasumiLockDatum(datum)`, `decodeCardanoTransaction(b64)`, `addressCredentials(bech32)`, `validateMasumiExtra(v, network)`, `jcs`, `computeTermsDigest`, `LOVELACE_ASSET`, `parseAssetUnit` | cardano:index.d.mts |

**Methods** (README in tarball):
- `default`: plain address-to-address transfer.
- `masumi`: Masumi escrow plus a seller-signed quote.
- `script`: any server contract; `extra.script` / `parameters` / `scriptHash` plus an optional `extra.datum` CBOR. The facilitator checks that the script address equals payTo but does **not** check the datum.

All three use the `authorization` flow, where the client never submits.

## Deadlines

| | x402 path (lib default) | Standard MIP-003 path (masumi.ts:102-107) |
|---|---|---|
| pay_by | now + maxTimeoutSeconds (demo 300 s) | +15 min |
| submit_result | payBy + 15 min | +40 min |
| unlock | payBy + 35 min | +60 min |
| external_dispute_unlock | payBy + 55 min | +80 min |

- Minimum gaps (Masumi rules): payBy → submit ≥ 5 min; submit ≥ now + 15 min; submit → unlock ≥ 15 min; unlock → dispute ≥ 15 min (DEVELOPER.md §2.4).
- Max horizon: 30 days (`MASUMI_MAX_DEADLINE_HORIZON_MS`).
- Agent margins: give up at submit − 5 min; fail a lock not seen by payBy + 5 min (agent.ts:188-190).
- `cooldown_period` on preprod is 420 000 ms (chain.ts:65).
- The buyer can `WithdrawRefund` only after `submit_result_time` if no result was posted. The demo has **no buyer refund tooling** (README "Limits").
- In practice: the result must be on chain within about 20 min of payment, and the seller can collect after about 40 min.

## Registration (`npm run register`)

- Script: scripts/register.ts → `chain.register(registryMetadata(listing()))` (chain.ts:203-218).
- Mint: +1 of policy `67ab0c92…` (vendored `registry-v2.plutus.json`, no params) with asset name `"10" ‖ blake2b_224(seedTxHash ‖ u32be(index)) ‖ "000000"` (masumi.ts:23-27) and redeemer `Constr 0 []`.
- The tx sends the NFT plus 2 ADA (autoMinUtxo) to the seller address, attaches CIP-25-style label 721 metadata `{policy:{assetName: meta}, version:"1"}`, and adds the seller as signer.
- Metadata (masumi.ts:59-82): strings chunked at 60 bytes. Fields: `name`, `description`, `api_base_url`, `author.name`, `tags`, `image`, `metadata_version:"2"`, and `supported_payment_sources:[{chain:"Cardano", network:"Preprod", settlement:{paymentSourceType:"Web3CardanoV2", address: ESCROW}, pricing:{pricingType:"Fixed", fixed:[{asset: tUSDM unit, amount}]}}]`.
- Output: `MASUMI_AGENT_IDENTIFIER = policy + assetName` (120 hex).
- Deregister: burn with redeemer `Constr 2 []` (chain.ts:221-232).
- The registry is the only thing that requires a public HTTPS `AGENT_PUBLIC_URL` with a reachable `/availability`. Buyers validate a claimed id through Blockfrost `/assets/{id}` and `/assets/{id}/addresses` (registry.ts:26-57). The checks:
  - exactly one source;
  - escrow, price and asset match;
  - the resource URL sits under `api_base_url`;
  - the NFT holder has the seller's payment key.

## Env vars (masumi/.env.example, config.ts)

| Variable | Status | Notes |
|---|---|---|
| `BLOCKFROST_PROJECT_ID` | required | preprod key |
| `BLOCKFROST_BASE_URL` | optional | default `https://cardano-preprod.blockfrost.io/api/v0` |
| `SELLER_MNEMONIC` | required | 24 words; fund with about 20 tADA |
| `AGENT_PUBLIC_URL` | required | no trailing slash; used as the x402 `resource` base |
| `MASUMI_AGENT_IDENTIFIER` | required by `config.agentIdentifier()` | 120 hex, starts with the registry policy. The agent as written throws without it (agent.ts:77). We must make it optional. |
| `PRICE_TUSDM_UNITS` | optional | default 1000000 |
| `X402_ADA_PRICE_LOVELACE` | optional | default 5000000; empty disables the tADA offer |
| `PORT` | optional | 8787 |
| `AGENT_NAME`, `AGENT_DESCRIPTION`, `AGENT_AUTHOR`, `AGENT_TAGS`, `AGENT_IMAGE` | optional | registry listing |

Separate standalone facilitator (facilitator/src/facilitator.ts:9-55): `BLOCKFROST_PROJECT_ID`, `CONFIRMATION_TIMEOUT_MS` (75000), `ACCEPT_MEMPOOL`, `PORT` (4022). Exposes `POST /verify` and `POST /settle` taking `{paymentPayload, paymentRequirements}`, plus `GET /supported`.

**Wallet handling:**
- The mnemonic sits in a plain `.env`.
- The same mnemonic feeds `toMasumiSellerSigner` (terms) and Evolution `withSeed` (txs). `checkWallet` asserts the two give the same address (chain.ts:148-152).
- Buyer and seller must be different wallets (cip30Signer.ts:60-62).

**Blockfrost usage:**
- Evolution provider (`withBlockfrost({baseUrl, projectId})`).
- Raw REST: `/txs/{h}/utxos`, `/blocks/latest`, `/assets/{id}`, `/assets/{id}/addresses`, `/epochs/latest/parameters`.
- Header: `project_id`.

## Evolution SDK 0.5.13 APIs used

- Client: `Client.make(preprod).withBlockfrost({ baseUrl, projectId }).withSeed({ mnemonic })` (chain.ts:135). In the browser, `.withCip30(api)` (cip30Signer.ts:24).
- Reads:
  - `client.address()`, `client.getWalletUtxos()`
  - `client.getUtxos(addr)`, `client.getUtxosWithUnit(addr, unit)`
  - `client.getUtxosByOutRef([new TransactionInput.TransactionInput({ transactionId: TransactionHash.fromHex(h), index: BigInt(i) })])` (chain.ts:180-187)
  - `client.awaitTx(hash, 5000, 300000)`, `client.getProtocolParameters()` (reference signer)
- Build: `client.newTx()` then the chain below, which returns a builder with `.sign()` → `.submit()`; also `.toTransaction()` (chain.ts:209-216, 263-272):
  - `.collectFrom({ inputs, redeemer? })`
  - `.attachScript({ script })`
  - `.mintAssets({ assets, redeemer })`
  - `.payToAddress({ address, assets, datum?: new InlineDatum.InlineDatum({ data }), autoMinUtxo? })`
  - `.attachMetadata({ label: 721n, metadata })`
  - `.addSigner({ keyHash: KeyHash.fromHex(vkh) })`
  - `.setValidity({ from?, to })` (POSIX ms bigint)
  - `.build({ changeAddress, availableUtxos, autoMinUtxo? })`
- Data and scripts:
  - `Data.constr(i, fields)`, `Data.int`, `Data.bytearray(hex)`, `Data.list`, `Data.isConstr`
  - `UPLC.applyParamsToScript(code, params)`, then `CBOR.fromCBORHex` to unwrap, then `new PlutusV3.PlutusV3({ bytes })`
  - `ScriptHash.fromScript`
- Assets: `Assets.addByHex(Assets.zero, policy, name, n)`, `Assets.withLovelace`, `Assets.fromLovelace`, `Assets.getUnits`, `Assets.getByUnit`, `Assets.lovelaceOf`, `Assets.hasMultiAsset`.
- Time: `SlotConfig.SLOT_CONFIG_NETWORK.Preprod`, `Time.unixTimeToSlot`, `Time.slotToUnixTime` (chain.ts:59-69).
- Address: `Address.fromBech32`, `Address.toBech32`, `new Address.Address({ networkId: 0, paymentCredential, stakingCredential })`.
- Evolution evaluates script txs during `build()` (via Blockfrost), so a failing validator throws before signing (chain.ts:9-11).

## License

- `x402-cardano-demo`: no LICENSE or COPYING file anywhere in the repo, no `license` field in any package.json (`"private": true`), and the GitHub API returns `license: null`. **Treat it as not licensed for copying.** We can read it for reference, but we must write our own code and not paste files. This is the main legal blocker if anyone planned to fork it.
- `masumi/contracts/*.plutus.json`: vendored unmodified from `masumi-network/masumi-payment-service` at commit `69297f3`, MIT © 2024 NMKR (contracts/NOTICE.md). We can vendor these ourselves from upstream with the MIT notice.
- `@x402/cardano`, `@x402/core`: Apache-2.0 (npm `license` field).

## Gotchas

1. **Handler runs before settle** in `@x402/express`. Do no chain work in the handler; record the job by txHash and let a watcher pick it up (DEVELOPER.md §8.9).
2. **Read the job input from `accepted.extra.inputCommitment.parts[0].content`**, not `req.body`. On a paid retry the lib serves the stored quote (agent.ts:155-156).
3. **The 2.26 client scheme does not pass `resource` to the signer** (cardano:chunk-AODABNQH.mjs:67-74 passes only network, payTo, asset, amount, maxTimeoutSeconds, extra). `verifyMasumiAuthorization` *rejects* any registry claim when `resource` is missing (cardano:chunk-MVYC4VJB.mjs:487-491). So the stock `toClientCardanoSigner` cannot pay a **registered** offer as is. Unregistered offers work.
   - The demo works around it by capturing `required.resource` and closing over it (x402Flow.ts:100-116).
   - Inference: wrapping the reference signer and spreading `{...input, resource}` should work, because it reads `input.resource` (index.mjs:351).
4. **The reference signer does not check that the commitment is *our* request.** It only checks that the commitment is self-consistent. Add our own deep-equal check of `parts[0].content` against what we POSTed, as the demo does (cip30Signer.ts:48-51).
5. **Spend controls:** lovelace and Masumi tUSDM are not default assets. Add `spendControls.allowedAssets` with `maxAmountPerPayment`, or the client rejects the offer (x402Flow.ts:109-111).
6. **Two "tUSDM" on preprod:** Masumi uses `16a55b2a…` + `0014df10745553444d`. The lib's `USDM_PREPROD_ASSET` is `e675b46e…`, a different token (constants.ts:14-23). Unit forms differ: x402 uses `policy.name`, Blockfrost and metadata use `policyname`.
7. **Exact lovelace:** the lock output must hold exactly `price(lovelace) + collateral_return_lovelace`. Use `autoMinUtxo:false` in custom builders (cip30Signer.ts:94-99). The lock tx TTL must be ≤ payByTime.
8. **Anyone can create escrow UTxOs with any datum.** Match every field of the datum and require the verified txHash (lockMatch.ts).
9. **SubmitResult validity:** the validator sees `slotStart(upper)`, which must be `< submit_result_time`. Seller cooldown must be ≥ `slotStart(upper) + 420 s`. The Withdraw lower bound must be rounded **up** to a slot ≥ unlock. Use chain tip time, not the local clock.
10. **Withdraw takes one escrow input per tx.** It must return the buyer collateral with an OutputReference datum. Keep a pure-ADA UTxO of at least 5 ADA for Plutus collateral (DEVELOPER.md §8.8).
11. **Jobs and quotes are in memory** (`InMemoryMasumiTermsStorage`, 10k entries). A restart loses sold jobs and the funds wait in escrow. Persist `expected` plus `input`. Also stop the agent before `collect` so the two don't spend the same inputs.
12. **x402-made locks cannot be driven by `masumi-payment-service` or Sokosumi.** The signature payload differs: `termsDigest` = `SHA-256("masumi:x402:terms:v1\n"‖JCS(terms))`. On this path `input_hash` is the lib's domain-separated commitment digest, **not** MIP-004 (FLOWS.md §3.1; tarball README "Relationship to masumi-payment-service").
13. **Each unpaid 402 signs a fresh quote**, so rate-limit the route. A route with a Masumi template must offer a single Cardano network.
14. `buyerNonce` in the terms is empty or 7-13 bytes. `identifier_from_purchaser` in the body is a separate field (types-BU8jAfFp.d.mts:119-120).

## What we must write ourselves

**Seller (specialist agent):**
1. Express app with MIP-003-ish routes (`/availability`, `/input_schema`, `/status`, `/jobs/by-tx/:hash`) and an x402 route using the `ExactCardanoScheme({masumi})` + `x402HTTPResourceServer` + `paymentMiddlewareFromHTTPServer` pattern. Make `agentIdentifier` optional (unregistered).
2. Job store keyed by lock txHash, preferably persistent (SQLite).
3. Watcher: lookup by tx through Blockfrost `/txs/{h}/utxos`, the `lockMismatch` equivalent, then run the real specialist task.
4. Evolution tx builders: `paymentScript()` (apply params to vendored `payment-v2.plutus.json`, MIT), `SubmitResult`, `Withdraw`/collect, slot-rounding helpers, chain-tip time, a serial tx queue.
5. Optional: registry mint (only if we want a listing; this needs a stable public URL) and an in-process facilitator.

**Buyer:**
1. Node `x402Client` + `ExactCardanoScheme(wrappedSigner)` around `toClientCardanoSigner` that injects `resource` and asserts our commitment content.
2. Spend controls and a policy that filters to `masumi` and the expected price.
3. Polling the seller by txHash.
4. **Refund tooling** (`WithdrawRefund`, redeemer 3, after submit_result_time), since nothing in the demo or library builds it. This is needed if we want a non-delivery story.

**Both:** separate seller and buyer preprod wallets funded with tADA (and Masumi tUSDM `16a55b2a…` if pricing in tUSDM; tADA is simpler, as the unregistered lovelace offer shows).
