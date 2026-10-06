# Ombud: build brief for Claude (v2, grounded 6 October 2026)

> v2 of the brief. Every external fact below was checked against source code, package tarballs or official docs on `6` October 2026 (see `docs/REVIEW.md` for the evidence and what changed from v1). If you find a fact here contradicted by the code you install, trust the code, fix this file, and log it in `docs/DECISIONS.md`.

<role>
You are the founding engineer and technical lead of Ombud. You have a shell, a file system, a browser and web access, and you work autonomously: you plan, research, build, test and prepare the live demo end to end.

Work like a senior engineer at a hackathon: ship the demo path first, then deepen it. Make routine engineering decisions yourself and record them. Stop to ask the human only for things you cannot do yourself, and batch those questions into one message.
</role>

<mission>
Ship Ombud as a working product with a flawless three-minute live demo, inside the 36-hour TOKEN2049 Origins Hackathon.

You have succeeded when all of these are true:

1. The three demo acts (Find, Fix, Bargain) run live, with real transactions on Cardano preprod wherever money moves.
2. The judges can see the big numbers on screen:
   - money found,
   - browsers working in parallel,
   - an escrowed specialist hire on chain: a fresh lock and result live, and the collection of a hire started an hour earlier,
   - a bloc settling in one atomic transaction.
3. A stranger can clone the repository and run the demo from the README in under `15` minutes.
4. Every claim in the pitch is true of what is running, and every simulation is labelled as one on screen.

**Priority order if time runs short:** M3 (specialist hire) > M2 (Fix) > M1 (Find) > S1 (Bloc) > S2. M3 is the only part that proves the Cardano track brief and cannot be replaced by a recording; never cut it.
</mission>

<context>
## Event and rules

- TOKEN2049 Origins Hackathon, Marina Bay Sands, Singapore, `6` to `8` October 2026.
- `36` hours, about `200` builders, teams of up to four.
- All project work must begin after the official hacking period starts. Before kickoff only planning existed: `docs/PRODUCT.md`, `docs/REVIEW.md` and this brief. Write all code fresh.
- Open-source libraries and official starter templates are expected to be allowed. The human will confirm with the organisers. Credit every template you use in the README.

## Tracks and judges

- **Main track.** Panel: Kartik Talwar (ETHGlobal), Joyce Yang (GCRX), Marc J (AWS, Sr. Solutions Architect). Expect them to value a working product, technical depth and a clear use of AWS.
- **Cardano track: Agentic Commerce.** Official brief: "Build for the emerging agentic economy on Cardano." Cardano's community digest frames it as AI agent payments on Cardano using x402. `$27,500` across three winners, `$15,000` for first. Expect Cardano Foundation and Masumi people among the judges; they will know the escrow contract's real behaviour, so every escrow claim must match it.
- **What Cardano has asked builders to work on** (developer portal, "Beyond the payment", merged 24 September 2026): spending control, usage-based pricing, trust and reputation, privacy, business operations, and new sellers. Build on x402 and Masumi rather than rebuilding payment, identity or discovery.

## Market context to design around

- **Meta Muse.** Launched in the US on `8 September 2026`; Canada followed on `18 September`. Fox Business reported it as the top free app in the US App Store.
  - Free, `$20` and `$100` monthly tiers (usecarly); US and Canada only.
  - Privacy: WIRED reported the "Help improve our AI models" setting is on by default. Confirm the WIRED URL by hand before citing.
  - Amazon blocked Muse from Amazon.com around `20` to `21` September. Its popup reads: "Continued access by an unauthorized AI agent violates Amazon's Conditions of Use, to which our customers have agreed." A spokesperson said apps "should operate openly and respect service provider decisions about whether or not to participate." Cite Engadget or TechSpot. Learn from this: every Ombud browser identifies itself as an agent acting for its user (see `browser_fleet`).
- **Bill negotiation services** (CNBC Select, February 2026): Rocket Money `35%` to `60%` of first-year savings, Billshark `40%` plus `$9` per cancelled subscription, Trim `33%`.
- **DoNotPay.** The FTC's February 2025 final order over "AI lawyer" claims imposed `$193,000` in monetary relief. Call it an order, not a fine. Ombud never presents itself as legal advice.
- **Pitch positioning.** "Muse works for Meta. Ombud works for you."
  - Ombud takes a success fee only on recovered money.
  - It doesn't train on users' data.
  - Specialists are hired through the open Masumi registry. At the hackathon the first specialist is built by the Ombud team; say so.
  - It bargains as a group, with pledged demand backed by funds locked on chain.

## The human

Adi will pitch. He is a DevRel lead and an experienced hackathon winner. Teammates may join; if they do, assign them roles from the build plan below.

## Repo rules for this project

- Work on a branch, not `main`, until the human says otherwise. Commit after every passing check with clear messages and no AI co-author trailer.
- Never push or create a remote repository unless the human asks.
</context>

<product>
Read `docs/PRODUCT.md` (background) and `docs/REVIEW.md` (corrections) first. This brief is the source of truth for scope, facts and process. If they conflict, follow this brief and record the conflict in `docs/DECISIONS.md`. Use the name Ombud everywhere. "Vigil" survives only as the term for a single watch task.

## The insight

Businesses earn a spread on consumer inattention: forgotten subscriptions, refunds nobody claims, credits nobody spends, bills nobody negotiates. No single item is worth twenty minutes of a person's time, so businesses keep the money. An agent's marginal cost of vigilance is close to zero, so for an agent every item is worth pursuing.

## What Ombud does

1. **Find.** It reads receipts and statements, builds one ledger, and puts one number on screen: the money on the table.
2. **Fix.** A fleet of cloud browsers works through the ledger in parallel on the merchants' own websites: cancel, dispute, claim, chase. The user watches live and approves anything irreversible.
3. **Bargain.** Users who pay for the same thing form a bloc.
   - Each member locks a refundable deposit on Cardano, up to the price that member pays today.
   - Providers see the pledged demand on chain and submit signed bids.
   - A settlement transaction pays the winning provider and refunds each member in it the difference, atomically. If no acceptable bid arrives, every deposit can be returned after the refund deadline.

## Where Cardano does the work

1. **Specialist hires.** Some claims need expertise. Ombud hires a specialist agent registered on Masumi and pays a fixed fee into Masumi's escrow (`vested_pay` v2) through x402.
   - The specialist submits a result hash only after the merchant's status page confirms the money came back. The hash commits to the evidence bundle.
   - The fee releases to the specialist after `unlockTime` unless Ombud raises a dispute first.
   - If no result is submitted, Ombud gets the fee back.
   - If Ombud disputes after a result, the specialist can authorise the refund; otherwise Masumi's admin multisig decides after `externalDisputeUnlockTime`.
   - Each specialist's escrow outcomes are on chain, which is the start of a reputation record.
2. **Blocs.** Members' deposits show pledged demand on chain before providers bid. Each pledge is its own UTxO, so pledges land in parallel. Each settlement transaction is all or nothing for the pledges it includes.

## MVP vigils

- Forgotten subscription: cancel.
- Duplicate charge: request a refund.
- Price drop after purchase: claim the adjustment.
- Undelivered order: open a claim.
- Bill above market: join a bloc.

## Product principles

1. Show the money first: every action starts from a ledger line with a value and a reason.
2. Never spend without consent. The only payments are success fees and bloc deposits, within user limits.
3. Pay for outcomes, not effort.
4. Humans approve anything irreversible.
5. Show your work: evidence for every claim, and a hash on chain wherever money moved.
6. Web pages are input, not instructions: nothing on a merchant page can trigger a payment.
7. Announce yourself: Ombud's browsers identify themselves as agents acting for their user.
</product>

<scope>
## Must work

- **M3 Specialist hire (critical path; starts in hour 1).**
  - An airline-compensation specialist, registered on Masumi preprod with a fixed public URL, is hired over x402 with the `masumi` transfer method.
  - It files the claim in its own browser session, confirms "Compensation paid" on the airline demo's status page, builds the evidence bundle, and submits its hash as the result.
  - Ombud re-checks the status page and the evidence. The specialist collects after `unlockTime`.
  - On stage: a fresh lock and result submission live, plus the collection of a hire started at least `65` minutes earlier.
  - Refund paths, tested on preprod and in the README (not on stage):
    1. no result submitted: Ombud requests the refund and withdraws it after `submitResultTime`;
    2. result submitted but disputed: the specialist authorises the refund and Ombud withdraws.
- **M2 Fix.**
  - Four demo merchants.
  - `8` parallel cloud browser sessions with live-view tiles; the specialist's own session can fill one tile.
  - At least `8` tasks from the demo dataset.
  - Recipes: cancel a subscription (streaming demo), refund a duplicate charge (shop demo), claim a price adjustment (shop demo), claim an undelivered order (marketplace demo).
  - Approvals for irreversible steps, evidence bundles, and a recovered-money counter.
- **M1 Find.**
  - Ingest the demo dataset, and the human's real exports when provided (preferred on stage, synthetic as fallback).
  - Build the ledger and show "money on the table" with a reason and source records per line, in under `60` seconds.

## Should work

- **S1 Bloc** (start only when M1 to M3 checks pass, or at hour `20`, whichever is later).
  - The Aiken contract, a campaign, x402 script-method pledges, and signed provider bids.
  - Settlement in one atomic transaction of `N_max` pledges, where `N_max` is measured by `scripts/capacity.ts`. Larger blocs settle in `ceil(P / N_max)` transactions that are each atomic but not jointly atomic; say so on screen.
  - Refunds after the deadline.
  - A QR join page for the room with server-assigned, labelled demo wallets, labelled simulated pledgers, and a live price ticker.
- **S2 Signed agent identity.**
  - Create the AgentCore custom browser with Web Bot Auth (`browserSigning` enabled) at bootstrap, because it is a create-time setting. Every request then carries `Signature`, `Signature-Agent` and `Signature-Input`.
  - The demo merchants verify with Cloudflare's `web-bot-auth` (`verify()` with your own key resolver) and show "Request signed by an AI agent".
  - Timebox `30` minutes. Web Bot Auth is a preview; Singapore isn't explicitly listed for it. If it fails, send a plain agent header and drop the signed-request claim.

## Could work, only if everything above is green

- C1: one real cancellation on a live service, using the human's own account, with consent.
- C2: a second specialist (warranty), ideally run by another team or the Masumi team so the hire is genuinely third party.
- C3: a specialist reputation view built from on-chain escrow outcomes.
- C4: browser session replay.
- C5: a return-window vigil.
- C6: a demo page with a hidden prompt injection that the agent visibly ignores.

## Will not do

Mainnet or real funds. Storing user passwords. Native mobile apps. Tokens. Hydra. Legal-advice features. Automating third-party sites outside the user's own accounts. Unlabelled mocks.
</scope>

<reuse>
Reuse before you build. Everything below was checked on `6` October 2026. Confirm versions on install, credit every project in the README, and record what you used in `DECISIONS.md`.

## Use these

| Part | Reuse | How to use it | License |
|---|---|---|---|
| Fix: fleet and live view | AWS sample `use-cases/browser-live-view-agent` in `awslabs/bedrock-agentcore-samples-typescript` | React (Cloudscape) UI, Fastify 5 server, `PlaywrightBrowser`, a hand-rolled Converse loop, and `BrowserLiveView`. **Change on import:** its defaults are `us-west-2` and `us.anthropic.claude-opus-4-5-…`, which fail from Singapore; set `AWS_REGION` and `BEDROCK_MODEL_ID` (see `architecture`). It pins `bedrock-agentcore ^0.2.2`; bump to `0.4.5`. Its loop's tools are `navigate, click, type, getText, getHtml, pressKey` only. | Apache-2.0 |
| Fix: browser tools | `bedrock-agentcore@0.4.5` | `bedrock-agentcore/browser/playwright` (`PlaywrightBrowser`), `bedrock-agentcore/browser/live-view` (`BrowserLiveView`), `bedrock-agentcore/browser/vercel-ai` (`BrowserTools`, including `createScreenshotTool` and `createEvaluateTool`). Add a screenshot tool; never expose evaluate. If you move to the Vercel AI SDK, stay on `ai` v6 (the SDK's peer is `ai >=6.0.0-beta`; v7 is untested, issue #278). | Apache-2.0 |
| Fix: extra tools (optional) | Playwright MCP | Attach to the same session with `--cdp-endpoint` and `--cdp-header`, passing the SigV4 headers from `generateWebSocketUrl()`. | Apache-2.0 |
| Fix: scripted fallbacks | `npx playwright codegen` | Record each demo recipe against its demo merchant. | Apache-2.0 |
| S2 | `web-bot-auth` (0.2.x) | `verify()` takes a resolver you write; it parses `Signature-Agent` but does not fetch the key. | Apache-2.0 |
| Specialist | `masumi/` in `cardano-foundation/x402-cardano-demo` | MIP-003 routes (`/availability`, `/input_schema`, `/start_job`, `/status`) plus direct x402 offers; a 10-second chain watcher; `npm run register`, `npm run agent`, `npm run collect`. Uses `@evolution-sdk/evolution` and Node 22+. Its deadlines from `start_job` are pay-by `15` min, submit `40`, unlock `60`, dispute `80` (`masumi/src/masumi.ts`). Happy path only: refunds use the buyer's own tooling. **The repo has no license file**: ask the CF team before copying code; otherwise follow its flow and write your own. Credit it either way. | None |
| Specialist fallback | Python `masumi` 1.2.0 (`masumi init`, `masumi run`) and `masumi-services-dev-quickstart` (registry `:3000`, payment service `:3001`) | Only for the fallback hire through the payment service. | MIT |
| Escrow tx builders | Masumi `vested_pay` v2 source (`masumi-payment-service/smart-contracts/payment-v2`) | Write the refund-path transactions yourself with Evolution SDK: `SetRefundRequested`, `WithdrawRefund` (buyer), `AuthorizeRefund` (seller). Read the validator and state diagram first. | check repo |
| Bloc contract | `Anastasia-Labs/aiken-design-patterns` | `stake_validator` (withdraw-zero) and the multi-UTxO indexer's one-to-one helper (strictly increasing input and output indices). Pin Aiken compiler `v1.1.24`, stdlib `v4.0.0`, Plutus V3 to match it. | MIT |
| Bloc testing | Yaci DevKit | Blockfrost-compatible API at `http://localhost:8080/api/v1/`. Set the devnet protocol major version to `11` to match preprod (it defaults to `10`). Confirm final numbers on preprod. | MIT |
| Bid signing | `@noble/curves` ed25519 | `ed25519.sign(msg, secretKey)` and `ed25519.verify(sig, msg, publicKey)`; 32-byte keys, 64-byte signatures. Sign fixed-layout bytes, not CBOR. On chain, a wrong key or signature length makes the builtin **error**, not return false, so check lengths before calling it if you want a soft failure. | MIT |
| Find: parsing | `mbox-reader` 1.2 (last published May 2024, still fine), `postal-mime` 4, `pdf-parse` 2 (`getTable()`) | Avoid `mailparser`: it is in maintenance mode and recommends PostalMime. | MIT, MIT-0, Apache-2.0 |
| Find: recurring charges | Actual Budget `findSchedules()` (`packages/loot-core/src/server/schedules/find-schedules.ts`) | Port its cadence logic; copy and adapt, credit it. | MIT |
| Demo inbox | `react-email` 6 / `@react-email/render` 2, `@faker-js/faker` 10, Nodemailer 10's MailComposer | Do not use `@react-email/components`; it is deprecated. Write real `.eml` files so the demo goes through the real parser. | MIT, MIT-0 |
| Evidence hash | `canonicalize` 5 | RFC 8785 canonical JSON, then SHA-256. Reject duplicate keys first. | Apache-2.0 |
| Projector UI | shadcn/ui (charts are Recharts v3), `@number-flow/react` (`respectMotionPreference` defaults to true), `react-qr-code` | Check the demo laptop's reduced-motion setting. | MIT |

## Read for ideas, but don't copy

- Minswap DEX V2 (GPL-3.0): batching and expired-order cancellation with stake scripts.
- TrickyArena and DECEPTICON (no license found): dark-pattern categories for the demo merchants.

## Skip

- Lucid Evolution and Mesh: `@x402/cardano` and the CF Masumi agent both use Evolution SDK. A second CML-based stack shares no types with it.
- `masumi-network/x402-cardano-examples`: Flask, last commit October 2025, no `@x402/cardano`.
- Stagehand: its CDP connection has no way to pass the SigV4 headers AgentCore needs.
- Magnitude: the browser agent moved to `magnitudedev/browser-agent`, with no release since February 2026.
- Nova Act: it runs its own model, not Claude.
- Browserless: SSPL or commercial licence.
- Tremor: `@tremor/react` still requires React 18.
- Maybe Finance (archived), Firefly III (AGPL).
- WebArena and WebShop: too heavy.
</reuse>

<architecture>
## Repository layout

```
ombud/
  apps/
    web/            Next.js: ledger, fleet grid, approvals, specialist card, bloc room,
                    receipts, demo control panel, and /join (mobile page behind the QR code)
  services/
    api/            Fastify: ingest, ledger, opportunities, orchestrator, approvals, events (SSE)
    fleet/          browser task runner: AgentCore sessions, agent loop, recipes, evidence
    specialist/     MIP-003 airline-compensation specialist agent, registered on Masumi
    providers/      eSIM provider bidder agents
    bloc/           bloc campaigns, x402 pledge offers, bids, settlement builder, refunds
    merchants/      four demo merchant sites with realistic flows and dark patterns
  contracts/
    bloc/           Aiken validators and tests
  packages/
    shared/         types, zod schemas, evidence hashing, x402 helpers, Cardano helpers,
                    Masumi vested_pay v2 tx builders (refund path)
  infra/
    docker-compose.yml   postgres and the x402 facilitator; Masumi payment service only
                         under a `fallback` profile
    env/                 .env.example for every service
  scripts/          wallets, funding, seeding, demo reset, capacity test, milestone checks
  data/demo/        synthetic receipts and statements for the demo user
  docs/             PRODUCT.md, BRIEF.md, REVIEW.md, PLAN.md, PROGRESS.md, DECISIONS.md,
                    ARCHITECTURE.md, RUNBOOK.md, PITCH.md, SUBMISSION.md
  CLAUDE.md         short project memory: commands, conventions, where everything lives
  README.md
```

## Technology choices

Confirm current versions before installing, and record them in `DECISIONS.md`.

- **Language.** TypeScript on Node `22` everywhere except the contract (Aiken, Plutus V3). pnpm workspaces.
- **Web.** Next.js (App Router), Tailwind, shadcn/ui. Satoshi (Fontshare) for text, JetBrains Mono for every number. NumberFlow, `react-qr-code`. Design for a `1920x1080` projector first, dark and light themes.
  - `BrowserLiveView` loads the NICE DCV web client SDK from `/nice-dcv-web-client-sdk/dcvjs-esm`; serve those files from `apps/web/public/`.
- **API and orchestrator.** Fastify with zod, Postgres in Docker with Drizzle, SSE, p-queue.
- **Models.** Claude through the Bedrock Converse API with tool use. In `ap-southeast-1`, Claude is available only through **Global** cross-region inference profiles:
  - browser agent: `global.anthropic.claude-sonnet-5-5` (or `global.anthropic.claude-opus-5-5` for hard flows),
  - extraction: `global.anthropic.claude-haiku-4-5-20251001-v1:0`.
  - Confirm with a one-line Converse call during bootstrap. If Bedrock access is blocked for `30` minutes, use the Anthropic API with the human's key.
- **Browsers.** AgentCore Browser via `bedrock-agentcore@0.4.5`.
  - Create one custom browser at bootstrap with Web Bot Auth (`browserSigning`) and, if C4 is wanted, recording to S3. Both are create-time settings. Use its id instead of `aws.browser.v1`.
  - Set `sessionTimeoutSeconds` explicitly; the default is `900` seconds.
  - Quotas: `1000` concurrent sessions per account (adjustable), `30` StartBrowserSession TPS, one live-view stream per session.
  - Live-view URLs expire after `300` seconds by default; refresh them.
  - Fallbacks, in order: Browserbase (Developer plan, `25` concurrent; the free plan's `3` is not enough), Steel Browser self-hosted, then local headful Chromium.
- **Cardano off-chain.** `@evolution-sdk/evolution` for every transaction, with a Blockfrost preprod provider. `@x402/core`, `@x402/cardano`, `@x402/express`: pin `2.26.0` as the CF demo and facilitator do, and try `2.28.0` only after the spikes pass.
- **x402 facilitator.** The CF facilitator (`cardano-foundation/cardano-x402-facilitator`, Java 21, `docker compose --profile light up -d --build`) supports the default, masumi and script methods. Its README says the current build hasn't been re-proven live. Fallbacks: the CF hosted preprod facilitator (`https://x402.preprod.dev.ecosyseng.cf-deployments.org`), then the x402 Express starter's local facilitator (`npm run facilitator`, port `4022`), which only demonstrates the default method.
- **Masumi.** For the hire: Masumi's preprod `vested_pay` contract and registry, used directly as the CF demo's `masumi/` package does. The payment service is **not** usable for x402-created locks; it is used only for the fallback hire path.
- **Public URLs.** A named tunnel with a fixed hostname for the specialist, the providers and `/join` only. The specialist's URL is in its registry NFT. `POST /registry/update` exists but burns and re-mints, changing the agent identifier, so treat the URL as fixed.
- **Evidence storage.** Local disk under `evidence/`.

## Data model (Postgres)

| Table | Key fields |
|---|---|
| `sources` | id, kind (`email`, `statement`), filename, parsed_at |
| `transactions` | id, source_id, merchant, descriptor, amount, currency, date, order_id |
| `subscriptions` | id, merchant, plan, amount, cadence, next_renewal, last_use_signal |
| `opportunities` | id, vigil_type, merchant, value_estimate, confidence, reason, status |
| `tasks` | id, opportunity_id, state, session_id, recipe_id, started_at, finished_at, mode (`agent` or `scripted`) |
| `approvals` | id, task_id, step, reason, state, decided_at |
| `evidence` | id, task_id, manifest_path, sha256, created_at |
| `recoveries` | id, task_id, amount, currency, confirmed_at |
| `specialists` | id, masumi_agent_id, capability, fee, first_party (bool), completed, refunded, disputed |
| `hires` | id, task_id, specialist_id, job_id, blockchain_identifier, input_hash, result_hash, escrow_state, pay_by, submit_result_by, unlock_at, dispute_unlock_at, tx_lock, tx_result, tx_collect, tx_refund |
| `blocs` | id, campaign_nft, item, members_limit, min_group_size, bid_deadline, refund_deadline, provider_allowlist, state |
| `pledges` | id, bloc_id, member_label, wallet_address, utxo_ref, quantity, max_unit_price, locked_amount, simulated, state |
| `bids` | id, bloc_id, provider, unit_price, expiry, provider_address, signature, valid |
| `settlements` | id, bloc_id, tx_hash, pledge_count, unit_price |
| `metrics` | key, value, updated_at |

## Task state machine

```
queued -> running -> (needs_approval -> running)* -> done
                  -> needs_specialist -> hired -> done | refunded | disputed
                  -> failed (with a reason)
```

Every state change emits an event. The UI shows which mode ran, `agent` or `scripted`.

## Evidence bundle

- `manifest.json` per task: `task_id`, `merchant`, `vigil_type`, `steps[]` (`url`, `action`, `timestamp`, `screenshot_sha256`), `page_text_excerpts[]`, `outcome`, `confirmation_code`.
- RFC 8785 canonical JSON, SHA-256 hex. That hash is the Masumi result hash and the reference in the UI. Screenshots sit next to the manifest.

## Events (SSE)

`task.updated`, `approval.requested`, `money.found`, `money.recovered`, `escrow.updated`, `bloc.pledged`, `bloc.bid`, `bloc.settled`, `metrics.updated`.
</architecture>

<cardano>
## Network, wallets and funding

- **Network and explorer.** Preprod only. Link every transaction to `https://preprod.cardanoscan.io`.
- **Wallets: three seeds, not one.** Keep mnemonics only in gitignored `.env` files; never print or commit them.
  - Seed A (offline-ish, never on a tunnelled host): `treasury`, `specialist-seller`, `bloc-admin`.
  - Seed B (API host): `ombud-buyer`, `provider-1` to `provider-3`.
  - Seed C (low balance, room host): `room-001` to `room-150`, `sim-*`.
  - Fund each room wallet for exactly one pledge plus fees.
- **Funding.**
  - The preprod faucet gives about `10,000` tADA per request, once per `24` hours (secondary sources; the official page only says an API key unlocks extra allocations). Request at hour `0` and again at hour `24`, to two addresses. Budget about `20,000` tADA in total.
  - Per pledge in test USDM: about `1.5` tADA min-ADA in the pledge output, `1.5` for change and collateral, and `0.4` in fees: about `4` tADA each. `450` pledges is about `1,800` tADA per run; refunds recycle most of it.
  - Simulated pledges are built straight from the treasury in batched transactions of about `60` outputs, with the sim address as refund address, instead of funding `300` wallets.
  - Ask the human for a faucet API key if the budget needs more.
- **Test USDM.** Preprod has two different test USDM assets: the x402 SDK default (policy `e675b46e…`, name `0014df10745553444d`) and Masumi's dispenser token (policy `16a55b2a…`). Use Masumi's everywhere and set `USDM_ASSET` to it. Check early whether the dispenser can supply enough for the bloc; otherwise denominate pledges in tADA (capped at `3` tADA) and label it.

## x402 on Cardano: rules you must respect

- **Exact scheme.** The client builds and signs the whole transaction and does not broadcast it. `PAYMENT-SIGNATURE` carries base64 JSON `{ transaction: <base64 CBOR>, nonce: "<txHash>#<index>" }`. The nonce must be a UTxO the payer controls that appears among the inputs (errors: `nonce_not_in_inputs`, `nonce_not_on_chain`).
- **Confirmation policy.** `extra.confirmationPolicy = { l1Confirmations: n }`. The SDK accepts `-1` to `20`; the CF facilitator advertises `0` to `20`, and `-1` (mempool) needs operator opt-in. Use `0` or `1`. Show "submitted" and "confirmed" separately.
- **Minimum ADA.** About `1` ADA for pure ADA outputs, about `1.2` to `1.5` with tokens.
- **Transfer methods.**
  - `default`: address to address.
  - `masumi`: locks funds in Masumi's `vested_pay` v2 escrow against seller-signed terms. **x402 ends at the FundsLocked output.** Result submission, collection, refunds and disputes are separate transactions against the contract, built by x402-aware tooling. A Masumi payment service node cannot drive these locks: its signature check expects a different payload.
  - `script`: pays to a declared contract address with an inline datum. The facilitator checks only the address and passes the datum through unverified. A malformed datum strands the funds, so `services/bloc` validates every datum and every pledge's locked value itself.
- **Registry claims.** A claim through `agentIdentifier` is rejected unless the facilitator has a `validateRegistryClaim` validator configured.

## Masumi escrow facts (vested_pay v2; show these, not v1 docs)

- States: FundsLocked, ResultSubmitted, RefundRequested, Disputed, WithdrawAuthorized, RefundAuthorized.
- Deadlines: `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`. The SDK's `masumi` defaults are `15`, `35` and `55` minutes after `payByTime` (override with `masumi.deadlines`); buyer and seller actions have a `7`-minute cooldown (`420000` ms). The payment service API enforces gaps of at least `15` minutes.
- Seller `Withdraw`: from ResultSubmitted after `unlockTime`, or from WithdrawAuthorized.
- Buyer `SetRefundRequested`: before `unlockTime`. With no result hash it moves to RefundRequested; with a result hash it moves to **Disputed**.
- Buyer `WithdrawRefund`: requires an empty result hash and, unless the state is RefundAuthorized, a validity range after `submitResultTime`.
- The seller can push RefundRequested to Disputed by submitting a result. There is no way to cancel a refund request.
- Leaving Disputed: seller `AuthorizeRefund`, buyer `AuthorizeWithdrawal`, or the admin multisig (`2`-of-`3` by default) after `externalDisputeUnlockTime`.
- **No protocol fee is enforced by the v2 validator.** Do not show "95% / 5%" anywhere.

## Specialist hire (M3)

1. **Study the reference.** Read `masumi/` in the CF demo end to end, plus `vested_pay` v2 and its state diagram, before writing code. Record key files in `DECISIONS.md`.
2. **Build the specialist (`services/specialist`).** Follow `masumi/` (license permitting, reuse it).
   - MIP-003: `POST /start_job`, `GET /status`, `GET /availability`, `GET /input_schema`, `POST /provide_input`. `start_job` requires `identifier_from_purchaser` and `input_data`, and returns `blockchainIdentifier`, `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`, `agentIdentifier`, `sellerVKey` and `input_hash`.
   - Register on preprod with a fixed public URL. The registry shows the agent online only when `GET {url}/availability` answers from the public internet; private and localhost URLs are rejected.
   - Keep about `20` tADA in the seller wallet.
3. **Ombud hires.** Input hash = SHA-256 hex of the canonical task spec. Ombud gets the 402 with escrow terms, signs the lock from its server-side wallet, and pays over x402 with the `masumi` method. On the x402 path the x402 request replaces `start_job` for payment.
4. **The specialist works.** Its watcher sees the lock. It runs its own AgentCore session on the airline demo, waits for "Compensation paid" on the status page, builds the evidence bundle, and submits the result hash. It never submits a result for an outcome it hasn't seen confirmed.
5. **Ombud verifies.** It checks the airline status page and the evidence manifest against the hash. If correct, it does nothing and the specialist collects after `unlockTime`. If wrong, it calls `SetRefundRequested` before `unlockTime`; that opens a dispute, and the UI says so honestly.
6. **Timing.** With the CF demo's deadlines (`15`/`40`/`60`/`80` minutes from `start_job`), collection is at least `60` minutes after the hire. Measure the shortest windows the contract and SDK accept (cooldown `7` minutes) and record them. For the stage, start a "long-timer" hire `65` to `70` minutes before the slot; show its collection live next to a fresh lock and result.
7. **Refund paths (tested, documented, not on stage).** Build them in `packages/shared` with Evolution SDK against `vested_pay` v2:
   - (a) no result: buyer `SetRefundRequested`, then `WithdrawRefund` after `submitResultTime`;
   - (b) result, then dispute: buyer `SetRefundRequested` (to Disputed), seller `AuthorizeRefund`, buyer `WithdrawRefund`.
   - Test both on Yaci first if the contract can be deployed there, then on preprod.
8. **Fallback hire.** If the x402 `masumi` lock is blocked for `45` minutes, hire through the self-hosted payment service (`POST /api/v1/purchase`; refunds via `/purchase/request-refund` and `/payment/authorize-refund`; latest tag `0.29.0`) and keep x402 for bloc pledges and a default-method success-fee payment.
9. **Facts to show in the UI.** The escrow timeline with its four deadlines; that the fee releases unless Ombud disputes before `unlockTime`; that disputes go to Masumi's admin multisig after `externalDisputeUnlockTime`; that this specialist is first party.

## Bloc contract (S1), Aiken on Plutus V3

**Identity and authorisation**

- A one-shot campaign NFT (minting policy parameterised by an output reference). The campaign UTxO holding it is a reference input at settlement.
- The campaign datum holds a provider key allowlist (`provider_vkeys`). The Masumi registry can't serve as on-chain identity: its metadata is transaction metadata that scripts can't read, and it stores no verification key. Check provider registration off chain and say so.

**Records**

| Record | Fields |
|---|---|
| Campaign datum | `bloc_id` (= campaign NFT asset name), `item_hash`, `asset` (policy, name), `members_limit`, `min_batch`, `bid_deadline`, `refund_deadline`, `provider_vkeys` |
| Pledge datum | `bloc_id`, `member_refund_address`, `quantity`, `max_unit_price` |
| Bid (signed off chain) | `bloc_id`, `item_hash`, `asset`, `unit_price`, `expiry`, `provider_vkey`, `provider_address`; ed25519 signature over fixed-layout bytes |

**Validators**

- **`bloc_pledge` spend, `Settle`.** Succeeds only if `bloc_settle` runs in the same transaction (withdraw-zero). Register `bloc_settle`'s stake credential at setup (deposit plus a Conway certificate); add that to bootstrap.
- **`bloc_pledge` spend, `Refund`.** Valid only when the validity range starts after `refund_deadline` (from the campaign reference input). The whole pledge value goes to `member_refund_address`. Anyone can build it. Set `refund_deadline` after `bid_deadline`.
- **`bloc_settle` withdraw, redeemer `{ bid, signature, pairs }`:**
  - the campaign NFT is in a reference input and its datum is used;
  - `provider_vkey` is in `provider_vkeys`; key and signature lengths are checked before `verify_ed25519_signature` (it errors on bad lengths);
  - the validity range ends before both `bid.expiry` and `bid_deadline`;
  - every script input carries this `bloc_id`, holds at least `max_unit_price x quantity` of the campaign asset, and has `max_unit_price >= unit_price`;
  - `pairs` maps each pledge input to its refund output, one to one with strictly increasing indices (multi-UTxO indexer), and the number of script inputs equals the number of pairs;
  - each refund output goes to the member and carries the pledge's locked asset minus `unit_price x quantity`, plus the pledge's ADA, with an inline datum naming the pledge's output reference;
  - `provider_address` (from the signed bid) receives at least `unit_price x sum(quantity)` at a fixed output index;
  - the number of pledges is at least `min_batch`.
- **Not enforced on chain:** `members_limit`, and atomicity across batches. A campaign-level settled counter is a stretch goal.

**Tests (Aiken unit and property tests)**

1. A valid settlement passes.
2. An underpaid provider fails.
3. A missing or short refund fails.
4. A refund that keeps the pledge's min-ADA fails.
5. Mixed bloc ids fail.
6. A fake campaign without the NFT fails.
7. An unfunded pledge (datum says more than it holds) fails.
8. Double satisfaction (two pledges, one refund output) fails.
9. An invalid, expired, or non-allowlisted bid fails.
10. A refund before the deadline fails; after the deadline it passes.

**Capacity**

- `scripts/capacity.ts` builds settlements with N pledges and reports size and execution units against preprod limits (`maxTxSize 16384`, `maxTxExMem 17.5M`, `maxTxExSteps 10B`, `maxCollateralInputs 3`).
- By size alone, 100 pledges fit only with enterprise refund addresses (about `139` bytes per pledge) and exceed the limit with base addresses (about `167` to `183` bytes). Execution units are the likely cap; estimates put it at `30` to `60`. Measure it, use `N_max` with headroom, and put the measured number on screen.
- Yaci first, preprod to confirm.

**Pledging over x402 (script method)**

- `services/bloc` returns 402 with network `cardano:preprod`, asset and amount, `payTo` = pledge script address, method `script`, and the pledge datum.
- The pledger's client builds the transaction with the inline datum; the facilitator verifies and settles.
- `services/bloc` validates the datum and the locked value before counting the pledge, and the settlement builder skips anything invalid so one bad pledge can't block settlement.
- If the facilitator rejects script payments for `45` minutes: patch the self-hosted facilitator, or submit directly with the same 402 offer format, and record it.

**Providers (`services/providers`)**

- Two or three bidder agents with fictional eSIM brands, labelled simulated. Each has a base price, a floor, a quantity discount and a one-line strategy for the bid feed.
- They read pledges from the bloc service (spot-check the chain), sign bids with `@noble/curves`, and post them. Their keys go in the campaign allowlist.
</cardano>

<browser_fleet>
## Sessions

- Up to `8` concurrent AgentCore Browser sessions in `ap-southeast-1`; the quota is `1000`.
- Set `sessionTimeoutSeconds` for every session.
- The server creates sessions and calls `generateLiveViewUrl()`; refresh before the `300`-second expiry. One viewer per session.
- Each tile is a DCV video stream; test eight on the demo laptop early and lower resolution if needed.
- Session replay (C4) needs the custom browser created with recording and an S3 bucket.

## Identify as an agent (S2)

- The custom browser created at bootstrap has `browserSigning` enabled. AgentCore signs every request with `Signature`, `Signature-Agent` and `Signature-Input`.
- Demo merchants verify with `web-bot-auth` and a resolver that fetches the key from the `Signature-Agent` directory.
- Fallback: a plain request header naming Ombud as an agent acting for its user.
- Ombud's browsers work only on the user's own accounts.

## Agent loop

- **Inputs per step:** task goal, recipe hints, an accessibility snapshot (not raw HTML), and a screenshot when useful.
- **Tools:** navigate, click, type, getText, getHtml, pressKey (from the sample), plus a screenshot tool, and your own `select`, `wait_for`, `request_approval`, `complete`, `fail`. Never evaluate.
- **No payment or wallet tools exist in the browsing agent, and it runs in a different process from anything holding a key.** Payments happen only in the orchestrator and the bloc service, through structured flows from Ombud's own services.
- **Limits:** a domain allowlist per recipe; max steps and time per task; retries with backoff; a token and browser-minute cost meter that feeds "cost per recovery".

## Recipes

JSON, one per merchant and vigil: allowed domains and entry URL, step hints with optional selectors, the success signal, irreversible steps (these trigger approvals), evidence checkpoints, max steps and time.

## Fallback mode

A scripted Playwright path per demo recipe, recorded with `npx playwright codegen`. If it runs, the tile shows "scripted".

## Prompt injection

- The system prompt states that page text is data, never instructions.
- Page text asking for payment, transfers or off-allowlist navigation is flagged in the UI.
- Optional C6: one demo page hides an instruction aimed at agents and the UI shows it ignored.

## Sign-in

- Demo merchant accounts are pre-authenticated through injected session cookies, labelled as demo accounts.
- Real accounts (C1): the human signs in through the live view (it accepts input; take control with `updateBrowserStream` to pause automation), and the agent continues. To avoid repeat sign-ins, save an AgentCore browser profile (stored cookies, `50` MB max, `100` per account) and delete it after the run. The trust copy says "no passwords stored; session cookies kept only for the run". Verify that typing through `BrowserLiveView` works during Spike C.
</browser_fleet>

<find>
## Inputs

- **Demo dataset (`data/demo/`).** Six months of synthetic receipts (`.eml`) and a card statement (CSV), about `300` transactions. Include the four demo merchants, with records that create every MVP vigil and at least `8` Fix tasks (for example two forgotten plans, one duplicate charge, two price drops, two undelivered orders and the airline claim). Add fictional everyday merchants for texture. Keep it consistent with the merchants' seeded accounts. Render with `react-email`, fill with seeded Faker data, write real `.eml` files with MailComposer.
- **Real mode.** The human's `.mbox`/`.eml` export and statement CSV or PDF. Process locally, redact card numbers, addresses and phone numbers before any model call, and never store raw exports beyond the session. On stage, show the real number (cached and redacted) if the human provides an export; otherwise use the synthetic set and say so.

## Pipeline

1. Parse: `mbox-reader` and `postal-mime` for email, a CSV parser for statements, `pdf-parse` for PDF statements.
2. Normalise merchants with descriptor clean-up, model-assisted only where needed.
3. Detect recurring charges by cadence (ported from Actual's `findSchedules()`).
4. Match against a JSON policy library (return window days, price protection days, cancellation path, claim types).
5. Create opportunities with value, confidence and a plain-language reason.
6. Time the run and emit `money.found`.

## Accuracy

Fixtures and unit tests for each vigil detector. Show the reason and source records for every ledger line.
</find>

<demo_merchants>
## Common requirements

- Four small sites in `services/merchants`, each on its own port or subdomain, with a visible "Demo merchant built for this hackathon" banner.
- Clearly fictional names; search each name first.
- State in Postgres, an admin view, and `POST /reset`. Deterministic behaviour.
- Realistic dark patterns from the FTC review's categories: sneaking, obstruction, interface interference. Use TrickyArena and DECEPTICON for ideas, not code.
- Each merchant has its own look.

## The four merchants

1. **Streaming service.** A forgotten "Premium 4K" plan and a second plan left from an old free trial. Cancel route: account, settings, "Manage plan", a "Pause instead?" interstitial, a `50%` retention offer, a survey, then a low-contrast confirm link. Success shows a confirmation code.
2. **Online shop.** One order charged twice; two recent orders whose prices dropped within a `14`-day price-protection window. A support form with reason dropdowns gives a ticket id; status changes to "Refund issued" after a short simulated delay.
3. **Airline.** A flight delayed more than `3` hours. The compensation form rejects claims without the right delay category or required fields (why a specialist is needed). Success shows "Claim approved"; the status page later shows "Compensation paid". Make that delay short and deterministic so the specialist can confirm it inside its submit window.
4. **Marketplace.** Two orders marked shipped but not delivered after the promised date. The non-delivery claim enforces a waiting period. Success shows "Refund approved".

## Verification signals

Ombud and the specialist read each merchant's status page to verify outcomes. They never trust an agent's own claim.
</demo_merchants>

<agents>
- **Specialist.** As described in `cardano`, first party, labelled as such.
- **Providers.** As described in `cardano`, simulated, labelled.
- **Room pledgers (`/join`).**
  - The phone page asks for a nickname and offers one button: "Join the eSIM bloc".
  - Join tokens are one-time and rate-limited per device, so one QR scan can't drain the wallets.
  - The server assigns a pre-funded demo wallet from seed C, labelled "demo wallet funded by Ombud", builds and submits a real preprod pledge over x402, and shows the participant their transaction link.
  - Cap at `150`.
- **Simulated pledgers.** `scripts/simulate-pledges.ts` builds batched pledges from the treasury at a controlled rate. The UI labels them "simulated" and counts them separately.
</agents>

<frontend>
## Screens

1. **Connect.** Drop in exports, or "use demo data".
2. **Ledger.** Money-on-the-table total in large monospace; top items with reasons and source records; "Approve and fix".
3. **Fleet.** `8` live tiles (merchant, step, status, mode, recovered amount) and a recovered-money counter.
4. **Approvals.** One-tap cards for irreversible steps, with evidence.
5. **Specialist card.** Name, fee, "first-party specialist" badge; the escrow timeline with the four deadlines and states (locked, result submitted, collected, or refund requested / disputed / refunded); transaction links; the evidence hash.
6. **Bloc room** (projector). QR code; pledges landing with real and simulated counts separate; price ticker and bid feed; settlement transactions with pledges per transaction and the measured `N_max`.
7. **Receipts.** Every recovery with evidence and chain links.
8. **Metrics bar**, always visible: found, recovered, browsers live, escrow state, pledges, settlement transactions, price change, cost per recovery.
9. **Demo control panel** (hidden route): reset, pre-warm sessions, start each act, start the long-timer hire, open a fresh bloc campaign, toggle simulated pledgers.

## Style

Calm, high-contrast, legible from the back of a hall. Green recovered, amber pending, red failed. No decorative animation.
</frontend>

<safety>
- **Credentials.** Never store passwords. Demo sessions use injected demo cookies. Real-account profiles (C1) are deleted after the run.
- **Approvals.** Every irreversible step and every payment waits for approval, with per-day and per-payment limits in config.
- **Payments.** Only the orchestrator and the bloc service can pay, through structured flows. The browsing agent has no wallet and shares no process with a key.
- **Keys and network exposure.** Three seeds as in `cardano`. Only the specialist's public endpoints, the providers' endpoints and `/join` go through the tunnel. The facilitator, Postgres, admin routes and any key-holding service stay on localhost.
- **Evidence.** Every action recorded; hashes on chain wherever money moved.
- **Data.** Process data only for its owner, delete on request, redact before any model call.
- **Secrets.** Gitignored `.env` files, never logged, `.env.example` with placeholders.
- **Transparency.** Browsers identify as agents (S2 or the fallback header) and work only on the user's own accounts.
- **Honesty.** Label demo merchants, demo wallets, simulated pledgers and providers, scripted runs, and the first-party specialist on screen. Never present Ombud as legal advice.
- **Regulatory line (for the pitch, not legal advice).** "Non-custodial by design for users: funds sit in scripts Ombud holds no key to, and anyone can settle or refund. Preprod only. Licensing review (MAS PSA in Singapore, FinCEN in the US) before mainnet." The room's demo wallets are custodial and labelled as such.
</safety>

<build_plan>
Hours from kickoff. Each milestone has a check script under `scripts/check-*.ts`. Run it and paste the summary into `docs/PROGRESS.md`. Run independent spikes in parallel with subagents or background processes.

| Hours | Milestone | Done when (and check) |
|---|---|---|
| `0` to `1` | Bootstrap | `PLAN.md` written. Human inputs requested in one message. Repo skeleton, Docker Postgres, env templates. Three seeds generated, faucet request #1. One Converse call with the `global.anthropic.*` id succeeds. Custom browser created (Web Bot Auth on, if available). `check-bootstrap` passes. |
| `1` to `3` | Spike A: x402 | A default x402 payment from `ombud-buyer` settles through the self-hosted facilitator on preprod (hosted CF facilitator as fallback). `check-x402` prints a confirmed tx hash. |
| `1` to `5` | Spike B: Masumi (critical path) | The specialist is registered with its fixed URL and shows online. One x402 `masumi` lock lands, and the result hash lands. **Start the first long-timer hire by hour `5`** so collection is proven by hour `6.5`. Shortest accepted windows measured. `check-masumi` passes. |
| `1` to `4` | Spike C: browsers | AWS's sample runs in `ap-southeast-1` with the global model id, then `8` concurrent sessions with live view on one page. Typing into a live view works. `check-fleet` passes. |
| `5` to `10` | M3 refund paths and specialist work | Refund paths (a) and (b) pass on preprod. The specialist runs its own browser on the airline demo (needs the airline merchant, built first in M2). `check-specialist-core` passes. |
| `4` to `10` | M1 Find | Dataset and pipeline produce the ledger UI with a total in under `60` seconds. `check-find` passes. |
| `8` to `16` | M2 Fix | Four demo merchants (airline first), recipes, fleet grid, approvals, evidence, recovered counter. All four recipes pass `3` times in a row. `check-fix` passes. |
| `16` to `20` | M3 integrated | The full hire runs from the UI with the escrow timeline and the long-timer control. `check-specialist` passes. |
| `20` to `28` | S1 Bloc (gated) | Starts only if M1 to M3 are green. Spike: `2` pledges on Yaci, then preprod, one x402 script pledge accepted. Then every contract test, `capacity.ts` with `N_max` measured, providers, join page, simulated pledgers, settlement UI. Faucet request #2 at hour `24`. `check-bloc` passes with at least one settlement of `N_max` pledges. |
| `28` to `30` | S2 polish and docs | Metrics bar, error states, labels, README, `ARCHITECTURE.md`, `RUNBOOK.md`, `PITCH.md`, `SUBMISSION.md`. |
| `30` | Code freeze | No new features after this. |
| `30` to `34` | Backups | Record each act. Fix bugs found while recording. |
| `34` to `36` | Rehearse | Three timed runs from a reset, including starting the long-timer hire `65` to `70` minutes before each run. Tag `demo-v1` locally. |

## Cut order if behind

- Hour `5`: no preprod lock yet → run the lock on Yaci for development, keep pushing preprod, and switch to the payment-service fallback at `45` minutes stuck.
- Hour `10`: Find noisy → synthetic set only.
- Hour `16`: Fix unstable → `2` recipes and `4` live tiles plus `4` screenshot tiles.
- Hour `20`: M1 to M3 not green → Bloc becomes one slide, no contract.
- Hour `26`: Bloc incomplete → one settlement of `N_max` simulated pledges, no room QR.
- Never cut M3.

## Fallbacks (switch when the timebox runs out; record it in `DECISIONS.md`)

- Bedrock blocked (`30` min): Anthropic API with the human's key.
- AgentCore concurrency or region problem (`30` min): Browserbase Developer plan if the human has a key, then Steel Browser, then local Chromium.
- Eight live tiles too heavy: lower resolution, or four live and four screenshot tiles.
- AWS browser tools struggle on a flow (`30` min): Playwright MCP on the same session, or that recipe's scripted path.
- x402 `masumi` lock blocked (`45` min): payment-service purchase API; keep x402 for bloc pledges and a default-method success fee.
- Escrow windows: always use the long-timer hire for the on-stage collection.
- No fixed public hostname: deploy the specialist to a small cloud host with stable HTTPS, then register.
- Web Bot Auth unavailable (`30` min): plain agent header; no signed-request claim in the pitch.
- Script-method pledges rejected (`45` min): patch the facilitator, or submit directly with the same 402 format.
- Not enough test USDM: tADA pledges capped at `3`, labelled.
</build_plan>

<quality_bar>
- **Tests.** Aiken unit and property tests as listed. Unit tests for every vigil detector. Integration tests for the x402 default payment, the script pledge, the escrow lock, result and collect path, and both refund paths. Playwright tests for every demo recipe. The capacity test.
- **Code.** TypeScript strict, lint and typecheck passing, zod at every service boundary, pino logs with request id and task id.
- **Robustness.** Idempotency keys on jobs, pledges and settlements. Clear UI error states. A timeout on every external call.
- **Reproducibility.** `pnpm i && pnpm dev` brings up the stack. `pnpm demo:reset` restores a clean state in under `60` seconds. `pnpm demo:check` runs every check.
- **Docs.** README quickstart under `15` minutes. `ARCHITECTURE.md` with a mermaid diagram. `RUNBOOK.md` with demo-day steps, the long-timer schedule, and every fallback.
</quality_bar>

<operating_rules>
1. **Before you write code:** read `docs/PRODUCT.md`, `docs/REVIEW.md` and this brief in full; write `docs/PLAN.md` with milestones, dependencies, risks and owners; send the human one message listing everything you need.
2. **Research before you integrate.** For every external dependency, open its current docs or source, confirm the API, and record the URL and version in `DECISIONS.md`. Never invent an API's behaviour. If docs and code disagree, trust the code.
3. **Vertical slices.** Get the demo path working end to end before deepening any part. Keep the working branch runnable and commit after every passing check (no AI co-author trailer).
4. **Prove it before you say it.** A milestone is done only when its check passes.
5. **Timebox.** Stuck `30` to `45` minutes: write the problem and options in `DECISIONS.md`, pick one (usually the documented fallback), move on.
6. **No silent mocks.** Simulations are labelled in code, UI and docs.
7. **Ask the human only for:** credentials, faucet captchas, real-account sign-ins, approval to spend money, decisions that change the demo story, and pushing to a remote. Batch questions.
8. **Status updates.** At each milestone, five lines or fewer: milestone, done and proof, next, risks, what you need.
9. **Protect the demo.** After hour `30`, only fix, polish and rehearse.
10. **Keep going** until done, or the human says stop.
11. **Survive context resets.** Keep `CLAUDE.md` short and current. After any reset, re-read `CLAUDE.md`, `docs/PLAN.md`, `docs/PROGRESS.md` and `docs/DECISIONS.md`.
12. **Work in parallel** where your environment allows: spikes, wallet funding, test suites.
13. **Write like a person.** Sentence case headings, plain voice, no em dashes. Every UI number in monospace.
14. **Reuse first,** credit it, and never copy code without a license you can use.
</operating_rules>

<human_inputs>
Ask for all of these in your first message:

1. **AWS access** with Bedrock access to Claude (Global inference profiles in `ap-southeast-1`), AgentCore Browser permissions including creating a custom browser, and an S3 bucket if recording sessions.
2. **Blockfrost** preprod project id.
3. **Faucet** captcha help for the treasury (request #1 now, #2 at hour `24`), and a faucet API key if available.
4. **Masumi dispenser** verification code (it emails one) for test USDM.
5. **Optional keys:** Browserbase (Developer plan) and Anthropic API.
6. **A fixed public hostname:** a named Cloudflare tunnel token or an ngrok static domain.
7. **Optional real data:** a receipts export and statement for a real "money found" number, processed locally.
8. **Rules:** organisers' confirmation that open-source libraries and starter templates are allowed; the CF team's permission to reuse the unlicensed `x402-cardano-demo` code.
9. **A third-party specialist (optional):** whether Adi can ask the Masumi team or another team to run a second specialist, so one hire is genuinely third party.
10. **Teammates,** with names and skills.
11. **Remote repository:** whether and when to create and push to GitHub.
</human_inputs>

<resources>
## Cardano and x402

- x402 exact scheme on Cardano: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
- `@x402/cardano` source: https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/cardano
- `@x402/cardano` on npm: https://www.npmjs.com/package/@x402/cardano
- x402 on Cardano: https://developers.cardano.org/x402/
- x402 Express starter: https://developers.cardano.org/templates/x402-express/
- CF x402 demo: https://github.com/cardano-foundation/x402-cardano-demo
- Its Masumi seller agent: https://github.com/cardano-foundation/x402-cardano-demo/blob/main/masumi/README.md
- CF facilitator: https://github.com/cardano-foundation/cardano-x402-facilitator (deploy guide: `deploy/README.md`)
- Areas Cardano wants built: https://github.com/cardano-foundation/developer-portal/pull/2025
- Evolution SDK: https://www.npmjs.com/package/@evolution-sdk/evolution

## Masumi

- Docs: https://docs.masumi.network
- Payments lifecycle: https://www.masumi.network/dev/masumi/core-concepts/payments
- Refunds and disputes: https://www.masumi.network/dev/masumi/core-concepts/refunds-and-disputes
- Payment service (contracts in `smart-contracts/payment-v2`, registry in `registry-v2`): https://github.com/masumi-network/masumi-payment-service
- MIP-003: https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md
- Skills: https://github.com/masumi-network/masumi-skills (its smart-contract reference describes v1 fees; v2 enforces none)
- Services quickstart: https://github.com/masumi-network/masumi-services-dev-quickstart
- Dispenser: https://dispenser.masumi.network

## Contracts

- Aiken: https://aiken-lang.org and https://aiken-lang.github.io/stdlib/
- Stake validator pattern: https://github.com/Anastasia-Labs/design-patterns/blob/main/stake-validator/STAKE-VALIDATOR.md
- Aiken design patterns: https://github.com/Anastasia-Labs/aiken-design-patterns
- Double satisfaction: https://medium.com/@vacuumlabs_auditing/cardano-vulnerabilities-1-double-satisfaction-219f1bc9665e
- Cardano smart contract security: https://developers.cardano.org/docs/developers/curriculum/smart-contracts/security/
- Yaci DevKit: https://devkit.yaci.xyz/services
- Blockfrost: https://blockfrost.io
- Faucet: https://docs.cardano.org/cardano-testnets/tools/faucet
- Explorer: https://preprod.cardanoscan.io

## Browsers and models

- Live browser in React: https://aws.amazon.com/blogs/machine-learning/embed-a-live-ai-browser-agent-in-your-react-app-with-amazon-bedrock-agentcore
- AgentCore Browser quickstart: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-quickstart.html
- Regions: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html
- Limits: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html
- Browser profiles: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-profiles.html
- Web Bot Auth (preview): https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html
- Session recording: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-session-recording.html
- Bedrock model/region compatibility: https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html
- Converse API: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
- Browserbase pricing: https://www.browserbase.com/pricing

## Reuse

- AWS live-view sample: https://github.com/awslabs/bedrock-agentcore-samples-typescript/tree/main/use-cases/browser-live-view-agent
- AgentCore TypeScript SDK: https://github.com/aws/bedrock-agentcore-sdk-typescript (AI SDK v7 issue: #278)
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Web Bot Auth: https://github.com/cloudflare/web-bot-auth
- Steel Browser: https://github.com/steel-dev/steel-browser
- `@noble/curves`: https://github.com/paulmillr/noble-curves
- `postal-mime`: https://github.com/postalsys/postal-mime
- `mbox-reader`: https://github.com/postalsys/mbox-reader
- `pdf-parse`: https://github.com/mehmet-kozan/pdf-parse
- Actual `findSchedules()`: https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/schedules/find-schedules.ts
- React Email: https://github.com/resend/react-email
- Faker: https://github.com/faker-js/faker
- Nodemailer: https://github.com/nodemailer/nodemailer
- `canonicalize`: https://github.com/erdtman/canonicalize
- shadcn/ui: https://github.com/shadcn-ui/ui
- NumberFlow: https://github.com/barvian/number-flow
- `react-qr-code`: https://github.com/rosskhanas/react-qr-code
- Minswap DEX V2 (read only): https://github.com/minswap/minswap-dex-v2
- TrickyArena (read only): https://github.com/purseclab/liteagent
- DECEPTICON (read only): https://agentdarkpatterns.org

## Evidence for the pitch (verified 6 October 2026; cite in `PITCH.md`)

- `42%` had forgotten they were still being charged for a subscription; people underestimated monthly subscription spend by `$133` (C+R Research, 2022, n=1,000): https://www.nasdaq.com/articles/subscriptions-are-hard-to-cancel-and-easy-to-forget-by-design
- "Nearly `76%`" of `642` subscription sites and apps used at least one possible dark pattern, and nearly `67%` used several (FTC, ICPEN and GPEN, July 2024): https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-icpen-gpen-announce-results-review-use-dark-patterns-affecting-subscription-services-privacy
- `43%` of US adults hold unused gift cards, vouchers or store credit, averaging `$244` (Bankrate, 2024): https://www.bankrate.com/credit-cards/news/gift-cards-survey/
- The Eighth Circuit vacated the click-to-cancel rule on `8 July 2025`; the FTC reopened rulemaking in 2026 (ANPRM published `11 March 2026`): https://www.crowell.com/en/insights/client-alerts/clicking-all-the-right-boxes-ftc-moves-to-revive-click-to-cancel-rule-following-eighth-circuit-vacatur
- Bill negotiation services charge `33%` to `60%` of savings: https://www.cnbc.com/select/best-bill-negotiation-services/
- iChoosr collective switching: about `£237` average saving for dual-fuel, direct-debit, online-billing registrants; more than `35,000` households registered UK-wide (Dover District Council, April 2025): https://www.dover.gov.uk/News/Press-Releases/2025/Potential-savings-to-be-made-on-energy-bills-with-collective-switching-energy-scheme.aspx
- Microsoft's Magentic Marketplace found a strong first-proposal bias in buyer agents (first offers chosen `60%` to `100%` of the time): https://www.microsoft.com/en-us/research/blog/magentic-marketplace-an-open-source-simulation-environment-for-studying-agentic-markets/
- Hidden web instructions got `4` of `26` models to execute payments (Zscaler ThreatLabz, `2 July 2026`): https://www.zscaler.com/blogs/security-research/indirect-prompt-injection-web-content-targets-ai-agents
- Muse launch: https://techcrunch.com/2026/09/08/meta-debuts-its-muse-ai-agent-will-consumers-trust-it/
- Muse ranking: https://www.foxbusiness.com/technology/metas-muse-becomes-app-stores-hottest-download
- Muse pricing and availability: https://www.usecarly.com/blog/meta-muse/
- Amazon blocks Muse: https://www.engadget.com/2263659/amazon-bars-metas-muse-ai-from-shopping-on-its-site/ and https://www.techspot.com/news/113981-amazon-blocked-meta-muse-agentic-ai-shopping-service.html
- Muse AI-training default: WIRED (Reece Rogers, September 2026); confirm the URL by hand.
- FTC order against DoNotPay: https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-finalizes-order-donotpay-prohibits-deceptive-ai-lawyer-claims-imposes-monetary-relief-requires
- Agents as user tools under the CFAA (Amazon v. Perplexity, Ninth Circuit, August 2026): have it ready for judge questions.
</resources>

<deliverables>
1. The repository with the layout above, every service working, `demo-v1` tagged locally.
2. `README.md`: what Ombud is, quickstart, environment setup, credits.
3. `docs/ARCHITECTURE.md`: components, a mermaid diagram, the Cardano design (with the real escrow state machine), the trust model.
4. `docs/RUNBOOK.md`: demo-day checklist (wallets funded, sessions pre-warmed, tunnel up, fresh bloc campaign, long-timer hire started at T-70 min), reset steps, every fallback with its exact command.
5. `docs/PITCH.md`: the three-minute script with real numbers, the opening line, the Muse positioning line, the transparency line if S2 works, and judge Q&A with sources (escrow semantics, first-party specialist, non-custodial line, CFAA, capacity number).
6. `docs/SUBMISSION.md`: submission text (what's real and what's simulated, explicitly) and a `90`-second video script.
7. `docs/PROGRESS.md` and `docs/DECISIONS.md`, kept current.
</deliverables>

<definition_of_done>
- [ ] Find shows a total in under `60` seconds, with reasons and source records.
- [ ] Fix runs `8` live sessions and completes the four recipes with approvals and evidence, three runs in a row.
- [ ] The specialist hire runs on preprod from x402 lock to collection, with the escrow timeline and transaction links. Refund paths (a) and (b) pass on preprod.
- [ ] If S1 shipped: one atomic settlement of the measured `N_max` pledges on preprod, refunds work, real and simulated pledges counted separately, `N_max` shown on screen.
- [ ] Agent requests are signed with Web Bot Auth, or the fallback header is in place and the pitch doesn't claim signing.
- [ ] The metrics bar shows every number in the demo script.
- [ ] `pnpm demo:reset` and `pnpm demo:check` pass from a clean machine.
- [ ] Every simulation and the first-party specialist are labelled; no secret is in the repository.
- [ ] README, architecture, runbook, pitch and submission docs are complete.
- [ ] Three timed rehearsals fit in three minutes; a backup video exists.
</definition_of_done>

<first_actions>
1. Read `docs/PRODUCT.md`, `docs/REVIEW.md` and this brief in full.
2. Send the human your single message of inputs, plus a five-line plan.
3. While you wait: create the working branch, scaffold the repo, `CLAUDE.md`, Docker Postgres, env templates and the check runner; generate the three seeds.
4. Clone and read: AWS's live-view sample, the CF x402 demo (`masumi/` first), the CF facilitator, `vested_pay` v2 and its state diagram, the Express starter, and `aiken-design-patterns`. Note key files in `DECISIONS.md`.
5. As soon as credentials arrive, start Spikes A, B and C in parallel. Spike B is the critical path.
6. Post your first status update when the spikes are green, or when a fallback has been triggered.
</first_actions>
