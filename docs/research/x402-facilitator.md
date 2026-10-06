# x402 facilitator on Cardano preprod: research notes

Researched 2026-10-06. Sources are cited as `file:line` (repo clones in the session scratchpad under
`refs/`) or as URLs. `FAC` = `refs/facilitator` (cardano-foundation/cardano-x402-facilitator, shallow clone).
`PKG` = `refs/npm/package` (`npm pack @x402/cardano@2.26.0`). `TPL` = `refs/devportal/examples/templates/x402-express`.

## 1. Summary and recommendation

- **Main path: the hosted CF preprod facilitator.** Its `/supported` endpoint was fetched live and lists
  all three methods (`default`, `masumi`, `script`) on `cardano:preprod`, with `l1Confirmations` 0..20
  (section 2). Our resource server only needs `HTTPFacilitatorClient({ url })`, as in
  `TPL/src/seller.ts:26`. We don't need Java, Docker or our own Blockfrost key on the facilitator side.
  The buyer still needs a Blockfrost key to build transactions (`TPL/src/buyer.ts:35-39`).
- **Fallback with no Java: an in-process TypeScript facilitator.** `@x402/cardano@2.26.0` exports a full
  facilitator scheme (`ExactCardanoScheme` from `@x402/cardano/exact/facilitator`, with `verify` and
  `settle`). Its `getExtra` advertises all three methods (`PKG/dist/cjs/exact/facilitator/index.js:1801-1805`).
  It needs only a Blockfrost project ID. The Express starter already ships this as `npm run facilitator`
  on port 4022 (`TPL/src/facilitator.ts`, about 100 lines). We can run it as a separate process or
  embed it in the seller (section 4).
- **Java self-host: not worth it for the hackathon.** It needs JDK 21 and PostgreSQL. Its README says
  this version has not been re-proven live (section 6). We would only use it if both options above fail.
- **Masumi warning:** a `masumi` lock created by `@x402/cardano` **cannot be driven through
  masumi-payment-service**. Its seller signature covers a different payload (`PKG/README.md:160-168`).
  Release, refund and dispute need x402-aware tooling that holds the seller key. Plan the demo around that.
## 2. Hosted facilitator: `GET /supported` (live, exact JSON)

`curl https://x402.preprod.dev.ecosyseng.cf-deployments.org/supported` returned:

```json
{"kinds":[{"x402Version":2,"scheme":"exact","network":"cardano:preprod","extra":{"assetTransferMethods":["default","masumi","script"],"areFeesSponsored":false,"l1Confirmations":{"minimum":0,"maximum":20}}}],"extensions":[],"signers":{"cardano:*":[]}}
```

- Networks: `cardano:preprod` only.
- Scheme: `exact`, x402 v2.
- Methods: `default`, `masumi`, `script`.
- `areFeesSponsored: false`: the payer builds the transaction and pays the fee.
- Confirmations 0..20. The minimum of 0 means mempool acceptance (`-1`) is **not** offered. Don't quote
  `l1Confirmations: -1`.
- `signers` is empty: the facilitator holds no keys.
- Other probes: `GET /` and `GET /health` returned 404. `POST /verify {}` returned
  `{"error":"Missing paymentPayload or paymentRequirements"}`. That body matches both the Java
  facilitator (`FAC/docs/api.md` transport errors) and the TS template (`TPL/src/facilitator.ts:48`),
  so the probes don't tell us which implementation is deployed. The `/supported` shape matches the Java
  docs byte for byte (`FAC/docs/api.md:199-217`).
- The starter template uses this URL as its default `FACILITATOR_URL` (`TPL/.env.example:3-4`).

## 3. Spec: `exact` on Cardano (x402-foundation/x402 main)

Source: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
(raw copy at `refs/spec_cardano.md`; line numbers below refer to it).

### Common PaymentRequirements (`accepts[]`)

`scheme: "exact"`, `network: "cardano:preprod"`, `amount` (string, smallest unit), `asset`
(`"lovelace"` or `policyIdHex.assetNameHex`, dot-separated), `payTo` (bech32), `maxTimeoutSeconds`
(600 suggested), and `extra` (spec:124-152). For reference, preprod tUSDM is
`e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d` (spec:143).

### confirmationPolicy (all methods), spec:154-168

`extra.confirmationPolicy = { "l1Confirmations": <int -1..20> }`. If omitted it defaults to `1`.
- `-1`: the facilitator's authenticated mempool acceptance.
- `0`: inclusion in a canonical block.
- `N`: N newer blocks.

It is not part of the Masumi `termsDigest`.

### `default` extra

`extra: { "confirmationPolicy"?: {...} }`. It can be empty, and `assetTransferMethod` may be omitted or
set to `"default"` (spec:146-150; `FAC/README.md:124`).

### `masumi` extra (spec:170-282), closed schema, unknown fields rejected

```js
extra: {
  assetTransferMethod: "masumi",
  confirmationPolicy?: { l1Confirmations: 1 },
  inputCommitment: { version: "1", algorithm: "sha256",
    parts: [{ name, canonicalization: "jcs", mediaType, content, digest }], digest },
  terms: { version: "1", paymentType: "Web3CardanoV2", sellerAddress, sellerReturnAddress?,
    sellerNonce /*32B hex, fresh per 402*/, buyerNonce /*"" or 7-13B hex*/, agentIdentifier?,
    inputHash /*== inputCommitment.digest*/, payByTime, submitResultTime, unlockTime,
    externalDisputeUnlockTime /*POSIX ms strings*/ },
  referenceKey /*COSE_Key hex*/, referenceSignature /*COSE_Sign1 hex*/,
  blockchainIdentifier /*LZString hex*/,
  deployment?: { requiredAdmins, adminVkeys[], cooldownPeriod }   // omit for canonical deployment
}
```

- `payTo` must equal the derived `vested_pay` V2 escrow address.
- Exactly one escrow output.
- The output carries an inline 19-field datum with `state == FundsLocked`, and no reference script.
- `lockedLovelace == amount + collateral_return_lovelace`, exactly. Collateral is 0 or at least 1,435,230.
- The transaction TTL must be no later than `payByTime` (spec:820-848).

The issuer must store each quote keyed by `termsDigest` and reuse it on the paid retry (spec:190-196).
In code we don't hand-build any of this. The server scheme issues quotes:
`new ExactCardanoScheme({ masumi: { seller: toMasumiSellerSigner({ mnemonic, network }) } })`, and the
route sets `payTo: masumiEscrowAddress("cardano:preprod")` and `extra: { assetTransferMethod: "masumi" }`
(`PKG/README.md:126-156`).

A non-empty `agentIdentifier` is rejected unless the facilitator has a `validateRegistryClaim`, so omit
it (`PKG/README.md:170-172`).

### `script` extra (spec:609-655)

```js
extra: {
  assetTransferMethod: "script",
  confirmationPolicy?: { l1Confirmations: 1 },
  scriptHash?: "<hex>",                         // if the script is on-chain
  script?: { type: "plutusV3", code: "<hex>" }, // full script (plutusV1|V2|V3)
  parameters?: { name: { value, type } },       // bytes|bigint|integer|string|constr|list|map|boolean
  datum?: "<CBOR hex>"                          // attached verbatim as an INLINE datum on payTo output
}
```
Type definitions: `PKG/dist/cjs/types-BU8jAfFp.d.ts:197-260`.

- The facilitator only checks that `payTo` equals the script address reconstructed from
  `script` + `parameters` (aiken UPLC `applyParamsToScript`, `PKG/dist/cjs/exact/facilitator/index.js:1677`)
  or from `scriptHash`.
- It **does not validate the datum**. A wrong datum strands funds, so the server owns datum correctness
  (spec:851; `PKG/README.md:82`).
- Combining PlutusV1 with an inline datum is rejected or unspendable. Use V3 (Aiken's default).
- The reference client signer attaches the datum (`PKG/dist/cjs/index.js:2588`) and builds Masumi locks
  (`:2595`).

### Payload (`PAYMENT-SIGNATURE`, base64 JSON), spec:657-700

`{ x402Version: 2, resource, accepted: <the chosen requirements, verbatim>, payload: { transaction:
"<base64 signed, unbroadcast tx CBOR>", nonce: "<txHash>#<index>" } }`.

`nonce` must be one of the transaction's inputs and is the replay guard.

### Settle response (`PAYMENT-RESPONSE`), spec:852-882

`{ success, network, transaction: <txHash>, extra: { status: "confirmed"|"mempool", confirmations } }`.

The non-terminal outcome is `success:false, errorReason:"settlement_pending"` with the transaction hash.
`@x402/core` retries settle exactly once with the same payload.

### Error codes (full catalog: `FAC/docs/api.md:268-381`)

- **Envelope:** `unsupported_scheme`, `invalid_exact_cardano_payload`, `network_mismatch`.
- **Transaction:** `..._transaction_decode_failed`, `..._network_id_mismatch`, `..._unsigned`,
  `..._invalid_signature`, `..._payer_not_witness`.
- **TTL:** `..._ttl_expired`, `..._not_yet_valid`, `..._ttl_too_far`.
- **Ledger:** `..._value_not_conserved`, `..._fee_below_minimum`, `..._phase1_invalid`.
- **Nonce:** `..._nonce_invalid`, `..._nonce_not_in_inputs`, `..._nonce_not_on_chain`,
  `..._input_not_available`.
- **Terms:** `..._recipient_mismatch`, `..._asset_mismatch`, `..._amount_insufficient`,
  `..._min_utxo_insufficient`.
- **Settlement:** `exact_cardano_facilitator_chain_lookup_failed` (503, retryable),
  `exact_cardano_settlement_failed`, `settlement_pending`,
  `exact_cardano_settlement_definitively_rejected`, `duplicate_settlement`.
- **Masumi payload:** `..._masumi_contract_mismatch|datum_missing|datum_invalid|datum_mismatch|deadline|
  collateral|min_utxo|reference_script|asset|escrow_output_count`.
- **Masumi requirements:** `invalid_exact_cardano_requirements_masumi_schema|seller_signature|deployment|
  agent_identifier|commitment|identifier`.
- **Script:** `invalid_exact_cardano_payload_script_address_mismatch`, `..._script_datum_missing`.
- **Server-side Masumi store (TS):** `masumi_terms_unknown`, `masumi_terms_mismatch`
  (`PKG/dist/cjs/index.js:268-269`).

`..._` stands for `invalid_exact_cardano_payload_`.
## 4. TS in-process facilitator (no Java)

The facilitator-side exports in `@x402/cardano@2.26.0` (from `npm pack`) are:
- `@x402/cardano/exact/facilitator` → `ExactCardanoScheme implements SchemeNetworkFacilitator`, with
  `verify(payload, req)`, `settle(payload, req)`, `getExtra()` and `getSigners()`
  (`PKG/dist/cjs/exact/facilitator/index.d.ts:82-144`). It also exports `InMemoryCardanoSettlementStore`.
- Config options (`index.d.ts:11-52`): `settlementStore`, `acceptMempool` (default false),
  `confirmationTimeoutMs` (default 75s), `confirmationPollMs`, `validateRegistryClaim`,
  `validateCustomMasumiDeployment`.
- `@x402/cardano` root → `toFacilitatorCardanoSigner({ network, provider: { blockfrost: { baseUrl,
  projectId } }, awaitConfirmation: false })`. No mnemonic or funds are needed
  (`PKG/dist/cjs/signer-BP9o9EXo.d.ts:575-643`).
  - Blockfrost is required for `confirmations > 0`. With Koios the maximum is 0 (`PKG/README.md:58`).
  - It includes `evaluateTransaction` (a Plutus dry-run) and live protocol parameters.
- `@x402/core/facilitator` → `x402Facilitator` with `.register(network, scheme)`, `.verify`, `.settle`
  and `.getSupported()`. Note that `getSupported()` is **synchronous**
  (`refs/npm/core/package/dist/cjs/facilitator/index.d.ts:51-94,150`).

Wiring, copied from `TPL/src/facilitator.ts:29-36`:

```ts
const signer = toFacilitatorCardanoSigner({ network: "cardano:preprod",
  provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId } },
  awaitConfirmation: false });
const facilitator = new x402Facilitator();
facilitator.register("cardano:preprod", new ExactCardanoScheme(signer, {}));
```

**In-process with no HTTP hop:** `x402ResourceServer` takes a `FacilitatorClient`, which is
`{ verify, settle, getSupported(): Promise<SupportedResponse> }`
(`refs/npm/core/package/dist/cjs/x402Client-CNluJCIi.d.ts:102-124`). A small adapter is needed:
`{ verify: (p,r)=>f.verify(p,r), settle: (p,r)=>f.settle(p,r), getSupported: async()=>f.getSupported() }`.
This is inferred from the type signatures and has not been run. The simplest option is still to run
`TPL/src/facilitator.ts` as a second process on `127.0.0.1:4022` and point `FACILITATOR_URL` at it.

**Limits:**
- The settlement store and the Masumi quote store are in memory only, so a restart loses the duplicate
  guard and issued quotes. That is fine for a demo (`PKG/README.md:110-124,156`).
- Every verify and settle call spends Blockfrost quota.
## 5. x402 Express starter (`developers.cardano.org/templates/x402-express`)

- Repo: https://github.com/cardano-foundation/developer-portal/tree/staging/examples/templates/x402-express
- Pinned packages (`TPL/package.json`): `@x402/cardano`, `@x402/core`, `@x402/express` and `@x402/fetch`
  at 2.26.0, plus `@evolution-sdk/evolution` 0.5.14. Node 20.9 or later.
- Scripts: `wallet`, `seller` (port 4021), `facilitator` (port 4022, bound to loopback; set
  `FACILITATOR_HOST`), `buyer` and `demo` (`TPL/package.json`, `TPL/src/facilitator.ts:95-101`).
- Environment: `FACILITATOR_URL` (defaults to the hosted URL), `SELLER_ADDRESS`, `SELLER_PORT`,
  `MNEMONIC`, `BLOCKFROST_PROJECT_ID`, and optionally `BLOCKFROST_BASE_URL` and `SELLER_URL`
  (`TPL/.env.example`).
- Seller (`TPL/src/seller.ts:26-49`): `new x402ResourceServer(new HTTPFacilitatorClient({ url }))`, then
  `.register("cardano:preprod", new ExactCardanoScheme())` (server scheme), then
  `paymentMiddleware({ "GET /api/message": { accepts: [{ scheme:"exact", network, price:{ amount:"2000000",
  asset:"lovelace" }, payTo }] } }, resourceServer)`.
- Buyer (`TPL/src/buyer.ts:31-48`): `new x402Client().setSpendControls({ allowedAssets: [{ network:
  "cardano:*", asset: "lovelace", maxAmountPerPayment: "5000000" }] })`, then
  `.register("cardano:*", new ExactCardanoScheme(toClientCardanoSigner({ mnemonic, network, provider })))`,
  then `wrapFetchWithPayment(fetch, client)`. Lovelace must be explicitly allowed in spend controls.
- Methods: the demo route only uses `default`. Its local facilitator uses the package scheme, so it
  verifies all three methods (`PKG/dist/cjs/exact/facilitator/index.js:1801-1805`).
- Fuller demo with Masumi escrow, USDM and a browser wallet:
  https://github.com/cardano-foundation/x402-cardano-demo (`TPL/README.md:119-120`).

## 6. Java / self-host path (cardano-x402-facilitator)

- **Stack:** Java 21 (`FAC/build.gradle:10`, toolchain 21), Spring Boot 3.5, Gradle 8.14 wrapper
  (`FAC/README.md:53,192`). Compatibility target is `@x402/cardano`/`@x402/core` 2.26.0 (`FAC/README.md:18`).
- **Endpoints:** `POST /verify`, `POST /settle`, `GET /supported`, `GET /health`,
  `/actuator/health`, `/actuator/prometheus`. Port 4022 (`FAC/README.md:101-109`).
  - A rejected payment still returns `200` with `isValid:false` (`FAC/README.md:128-134`).
- **Methods:** all three are built in and always advertised. There is no enable flag. The only
  method-specific config is an optional Masumi script-hash allowlist,
  `x402.masumi.allowed-script-hashes` (`FAC/docs/configuration.md:227-243`).
- **Blockfrost:** `BLOCKFROST_PROJECT_ID`, plus `BLOCKFROST_BASE_URL` (default
  `https://cardano-preprod.blockfrost.io/api/v0`). The network is set with `X402_NETWORK_ID`
  (default `cardano:preprod`). You can also use `NETWORKS_FILE=file:...`; it needs the `file:` prefix,
  otherwise it is silently ignored (`FAC/docs/configuration.md:13-33,52-162`).
- **Database:** PostgreSQL via `DB_URL`/`DB_USER`/`DB_PASSWORD`, default `localhost:5432/postgres`
  (`FAC/docs/configuration.md:35-50`).
  - H2 is a `runtimeOnly` dependency (`FAC/build.gradle:37`). Vendor detection handles it
    (`FlywayConfig.java:36-46`), and the interop harness runs the real server against
    `jdbc:h2:mem:interop;MODE=PostgreSQL` (`FAC/src/test/java/.../TypeScriptInterop.java:56`).
  - So `DB_URL='jdbc:h2:mem:x402;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1' DB_USER=sa
    DB_PASSWORD=` *probably* lets `bootRun` start without Postgres. This is untested, and the docs warn
    that H2 doesn't model the reconciler's concurrency semantics (`FAC/docs/testing.md:46-48`).
- **"light" Compose profile:** `postgres` plus `facilitator`, against hosted Blockfrost by default
  (`FAC/deploy/docker-compose.yml:3,39-46`; `FAC/deploy/README.md:35-40`). Other profiles: `full`
  (Mithril, cardano-node and yaci-store) and `yano`.
- **Running without Docker:** possible. `export JAVA_HOME=...; BLOCKFROST_PROJECT_ID=preprod... ./gradlew bootRun`
  (`FAC/README.md:72-77`). It still needs a reachable Postgres (or the H2 workaround above). Docker is
  only needed for the Testcontainers IT (`FAC/README.md:185`).
- **Not re-proven live:** "An earlier version was proven on preprod. This upgrade's verification uses
  a controlled offline chain; it has not repeated that live proof or run on mainnet. The full
  self-hosted Compose stack is not exercised by these tests." (`FAC/README.md:24-26`).
- **No auth or rate limiting.** Bind to loopback (`FAC/docs/configuration.md:245-254`).
- **JDK on this Mac:** `/usr/bin/java` is the macOS stub, and `/Library/Java/JavaVirtualMachines` is
  empty. Homebrew formula: **`openjdk@21`** (stable 21.0.12.1, bottled, keg-only; `brew info openjdk@21`).
  - Install with `brew install openjdk@21`.
  - Then `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.
  - Postgres is also available as `brew install postgresql@16`.
  - This is a reasonable fallback, but it adds two system services for no feature gain over the TS
    facilitator.

## 7. Gotchas

1. **Default confirmations.** `confirmationPolicy` defaults to 1 block, which takes about 20-80 s on
   preprod. `settle` waits up to 75 s, then returns `settlement_pending`. Core retries once, so a demo
   payment may take up to about 150 s (`FAC/docs/configuration.md:182`; facilitator d.ts:28-39).
   - For snappier demos, quote `l1Confirmations: 0`. Don't quote `-1`, because the hosted service
     advertises a minimum of 0.
2. **Pending doesn't mean failed.** `settlement_pending` with a transaction hash means the payment may
   still land. Don't re-pay; check cardanoscan first (`TPL/README.md:62`).
3. **Read the body, not the status.** `/verify` returns 200 even when `isValid:false`.
4. **Masumi seller signature differs from masumi-payment-service.** These locks can't be released or
   refunded through masumi-payment-service. Release, refund and dispute require our own seller-key tooling.
   - Lovelace must match `amount + collateral` exactly.
   - Only enterprise or key/key base addresses are allowed in the datum.
   - Omit `agentIdentifier` (`PKG/README.md:160-172`).
5. **Masumi routes.**
   - A route with a Masumi template may offer only one Cardano network.
   - Every unpaid 402 signs a fresh quote, so rate-limit those routes.
   - The quote store is in memory and bounded. Evicting a quote causes `masumi_terms_unknown` on a late
     retry (`PKG/README.md:156`).
6. **Script datums are not checked.** The datum is passed through unvalidated. Our Aiken pledge datum
   must exactly match the validator's expected CBOR, or the pledge is stranded.
   - Use PlutusV3. Inline datums at a V1 address are unspendable.
   - `payTo` must be the address derived from `script`+`parameters` (or `scriptHash`) for preprod.
7. **Scope of the phase-1 check.** Transactions that mint, withdraw or carry certificates are rejected
   without a full ledger validator. Pledge transactions must be plain transfers.
8. **Nonce.** It must be a transaction input (`txHash#idx`). A spent input makes verification fail. Don't
   reuse UTxOs across concurrent payments from the same buyer wallet.
9. **Hosted service is a shared dev deployment.** It has no auth, no SLA, and its implementation behind
   `/supported` is unverified (`/health` returns 404). Keep the TS facilitator ready as a drop-in:
   switching is a `FACILITATOR_URL` change.
10. **Network ids are exact strings.** `CARDANO:PREPROD` is rejected. The CIP-34 alias `cip34:0-1` is
    accepted (`FAC/docs/api.md:253-264`).
