# Ombud plan review (Prism, 6 October 2026)

Two Prism runs before kickoff:
- **r1** audited the product plan: 6 lenses, then 3 skeptics on the 4 load-bearing claims.
- **r2** audited the build brief: 4 lenses on claims new in the brief.

Every correction below is applied in `docs/BRIEF.md` v2. Evidence summary for r1 and r2 combined: **31 verified, 12 supported, 4 unverified, 9 contradicted**. The 9 contradicted claims have all been fixed in the brief.

## Recommendation

Make the escrowed specialist hire the spine of the build and the Cardano story, and start it in hour one.

Use the x402 `masumi` method to lock the fee, with Evolution SDK for every transaction. Build the refund-path transactions yourself, and show the release on stage from a hire started about 70 minutes before the slot.

Keep Find and Fix as the main-track story on AgentCore. In `ap-southeast-1` the Claude model IDs must be `global.anthropic.*`.

Gate the bloc at hour 20 and shrink it to one honest atomic settlement of a measured `N_max`. Fix every claim the escrow contract contradicts before a Masumi or Cardano Foundation judge does.

## Why

1. **The escrow doesn't do what the plan said.**
   - In `vested_pay` v2, a buyer's refund request after a result hash goes to **Disputed**, not to a refund. If the buyer does nothing, the seller is paid after unlock.
   - Source: `masumi-payment-service/smart-contracts/payment-v2/validators/vested_pay.ak` L254-270, 349-458, 643-656. Verified by 3 of 3 skeptics.
   - So "pays only when the money is back" holds only if the specialist submits a result after confirming the money came back, and Ombud can dispute otherwise. The brief now builds exactly that.
2. **x402 only locks.**
   - "A lock created by this package cannot be driven through a masumi-payment-service node." Source: `@x402/cardano@2.28.0` README L164-166. The node's signature check is in `src/routes/api/purchases/shared.ts` L273-279.
   - The plan's "payment service for refunds" path doesn't exist for x402 locks. The refund transactions are custom.
3. **Timing is fixed by the contract and tooling, not by choice.**
   - The CF demo's deadlines are 15, 40, 60 and 80 minutes after `start_job` (`x402-cardano-demo/masumi/src/masumi.ts` L102-106).
   - The SDK defaults are 15, 35 and 55 minutes after pay-by, with a 7-minute cooldown.
   - A live lock-to-release demo inside a three-minute slot is impossible. A long-timer hire started earlier is the only honest way to show the release.
4. **One transaction stack.** `@x402/cardano` and the CF Masumi agent both use `@evolution-sdk/evolution` (0.5.17, published 5 October 2026). Lucid Evolution and Mesh would add a second, incompatible stack.
5. **The model IDs and the bloc limits are set by the platform.**
   - From Singapore, Claude is available only through Global profiles. The AWS sample's `us.anthropic.claude-opus-4-5…` default fails there (`server/config.ts:14`).
   - "100 pledges per transaction" fits by size only with enterprise addresses. Execution units are the real cap, and they have not been measured.

## Steelman of the rejected option: keep the bloc as the hero

- **The case for it:**
  - The bloc is the novel idea: agents bargaining as a group with demand backed by locked funds.
  - "300 phones in the room pledge at once" is a memorable demo moment.
  - A new Aiken contract shows on-chain skill in a way that integrating someone else's escrow doesn't.
  - Cardano's UTxO parallelism is a real differentiator here.
- **Why it's still not the hero:**
  - Nothing about it exists yet.
  - Its headline claims are false as written: "100 per transaction", "all or nothing across 3 transactions", and identity from the Masumi registry.
  - Getting it right needs about 10 contract tests, stake-credential registration, a capacity benchmark and a custodial wallet fleet, all in 6 to 8 hours.
  - Its failure mode on stage is a stuck settlement.
  - The escrow hire uses exactly what the track sponsors built, and it fails gracefully because the long-timer hire is already on chain.
  - The bloc stays in the plan as a gated Should, at an honest size.

## Assumptions and falsifiers

| Assumption | Would change the plan if... | Check at |
|---|---|---|
| The x402 `masumi` lock works through the self-hosted CF facilitator | The facilitator's README says the current build hasn't been re-proven live. If it fails, use the hosted CF preprod facilitator; if that fails too, use the payment-service purchase path | Hour 3 |
| Escrow windows can be shortened below the CF demo's 40/60 minutes | If the contract and SDK accept 10/20 minutes, the long-timer lead time drops | Hour 5 |
| You can type into `BrowserLiveView` for sign-in | If not, C1 (real account) is dropped; demo merchants use injected cookies anyway | Hour 4 |
| Web Bot Auth works in `ap-southeast-1` | Singapore isn't listed for the preview. If it fails, use the plain header and no signing claim | Hour 1 |
| Execution cost per pledge in Aiken is about 0.18-0.3M memory units | If much lower, `N_max` approaches the size limit (about 83 with base addresses) | Hour 22 |
| There is enough Masumi test USDM for about 450 pledges | If not, pledge in tADA (capped at 3) | Hour 20 |
| The CF team allows reuse of the unlicensed demo code | If not, re-implement from its flow (about 2 extra hours) | Hour 1 |

## Open questions for Adi

1. **Is the bloc worth gating at all, or should it be a slide?** The practitioner lens says slide; the contract lens says one honest atomic transaction is doable in about 6 hours. The brief takes the middle path, gated at hour 20.
2. **Can you recruit a third-party specialist** (the Masumi team or another hackathon team) so at least one hire isn't first party? It is the strongest answer to "isn't this your own agent?"
3. **Will you provide a real inbox export?** A real number on stage carries far more weight than a synthetic one.
4. **Teammates?** The brief assumes Claude builds solo, with parallel subagents.

## Corrections applied in BRIEF.md v2

| # | v1 claim | Tier | Fix | Source |
|---|---|---|---|---|
| 1 | "If not confirmed, request a refund before unlockTime and get the fee back" | contradicted | Refund only with no result; after a result, it becomes a dispute. Two refund paths built and tested | vested_pay.ak L349-458 |
| 2 | Refund path through the Masumi payment service | contradicted (for x402 locks) | Custom Evolution SDK transactions; payment service only on the fallback hire path | @x402/cardano README L164-166 |
| 3 | UI shows "95% seller / 5% protocol fee" | contradicted | The v2 validator enforces no protocol fee; removed | payment-v2 README |
| 4 | "Disputes go to the Masumi team" | supported, imprecise | Admin multisig (2-of-3 default) after `externalDisputeUnlockTime` | x402 spec L531-545 |
| 5 | Demo windows about 20/40 minutes; Masumi defaults "unlock = submit + 12 h" | contradicted | Demo: 15/40/60/80 min from start_job. Service code default unlock = submit + 6 h (its docs say 12 h) | masumi.ts L102-106; payment-service routes |
| 6 | Lucid Evolution or Mesh; Lucid emulator | contradicted (stack) | Evolution SDK only; Yaci DevKit at protocol 11 | @x402/cardano deps; ClusterService.java:383 |
| 7 | Aim for 100 pledges per transaction; DoD "100+ settled" | partly refuted | Measure `N_max`; one atomic transaction; multi-transaction is not jointly atomic | Koios params; skeptic arithmetic |
| 8 | Bloc: campaign identity, provider key "registered as a Masumi agent", refund `(max-unit)×qty` | contradicted | Campaign NFT, provider allowlist in datum, refund = locked − unit×qty + ADA, signed `provider_address`, funded-value check, `min_batch` | Registry v2 README; bloc lens |
| 9 | One mnemonic for every wallet | design flaw | Three seeds; only public endpoints go through the tunnel | adversary lens |
| 10 | Masumi URL change means re-registering | partly refuted | `POST /registry/update` exists but burns and re-mints (new identifier) | payment-service routes |
| 11 | AWS sample tools include screenshot; evaluate to be removed | contradicted | Sample tools: navigate, click, type, getText, getHtml, pressKey. Add screenshot, never add evaluate | agent.ts L48-116 |
| 12 | "Confirm model IDs" | made concrete | `global.anthropic.claude-sonnet-5-5`, `…opus-5-5`, `…haiku-4-5-20251001-v1:0`; override the sample's us-west-2 defaults | Bedrock model cards; config.ts:5,14 |
| 13 | Web Bot Auth works with a timebox | supported | Create-time setting on a custom browser; Singapore not explicitly listed; `web-bot-auth` `verify()` needs your own resolver | AWS docs; web-bot-auth 0.2.0 |
| 14 | React Email | supported | `@react-email/components` is deprecated; use `react-email` 6 or `@react-email/render` 2 | npm |
| 15 | Amazon "blocked Muse from completing purchases… shopped without authorisation" | contradicted | Blocked from Amazon.com; quote the popup and spokesperson; cite Engadget or TechSpot, not Android Headlines (returns 403) | Engadget, TechSpot |
| 16 | Muse "US and Canada only" at launch | imprecise | US 8 Sep, Canada 18 Sep | TechCrunch, usecarly |
| 17 | "FTC fined DoNotPay" | imprecise | Final order, $193,000 monetary relief | FTC |
| 18 | "76%", "accepted the first proposal", "£237", "Zscaler July 2026" | imprecise | "Nearly 76%"; first-proposal bias (60-100%); £237 for dual-fuel DD registrants, 35,000 UK-wide; Zscaler 2 July 2026 | primary sources |
| 19 | Cardano track brief "using x402" | imprecise | Official: "Build for the emerging agentic economy on Cardano"; the x402 framing is from cardano.org | token2049.com; cardano.org digest |
| 20 | "Provable demand", "hires an open market", "never stores passwords" | overclaim | "Pledged demand backed by locked funds"; first-party specialist disclosed; profiles = stored cookies, deleted after the run | regulatory and fleet lenses |
| 21 | Faucet budget unspecified | gap | About 10k tADA per request every 24 h; budget 20k; sims batched from the treasury | faucet docs (secondary) |
| 22 | M3 at hours 18-24 | sequencing | Spike B is the critical path from hour 1; long-timer hire started by hour 5 | practitioner and adversary lenses |

## Still unverified (labelled in the brief)

- Execution units per pledge (no benchmark yet).
- The 10k tADA faucet amount (secondary sources only).
- The WIRED article URL.
- Steel Browser's one-session limit.
- Whether the CF facilitator's current build works live.

## Changelog

- **r1 → r2:**
  - The escrow semantics went from assumed to verified against the validator source. That turned the specialist flow around: the specialist submits a result only after confirmation, and Ombud disputes otherwise.
  - Claims that fell: the 95/5 fee, payment-service refunds of x402 locks, 100 pledges per transaction as stated, Lucid/Mesh, the 20/40-minute windows, and the Amazon paraphrase.
- **Open risk:** the self-hosted CF facilitator hasn't been re-proven live, and the escrow windows can't be shortened enough for a live release. Mitigation is in the brief: the hosted facilitator, then the payment service; and the long-timer hire.

> Cross-tier verification reduces instance- and tier-level error correlation but not
> shared-lineage blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry

- **divergence:**
  - r1: 0.71 (evidence 0.97, conclusion 0.33)
  - r2: 0.70 (evidence 0.95, conclusion 0.33)
  - threshold 0.30, uncalibrated
- **grounding:** P and R not available (no eval fixtures)
- **models:** draft = Opus; skeptics = 2× Opus + 1× Sonnet (cross-tier; the version axis isn't available)
- **claims:**
  - C1 escrow-dispute: grounded (vested_pay.ak line refs, 3 of 3 skeptics)
  - C2 x402-lock-not-payment-service: grounded (README plus shared.ts)
  - C3 100-per-tx: size part refuted by 2 of 3 skeptics, exec part unverified
  - C4 AgentCore: grounded, with the profiles nuance
  - r2 claims: grounded from cloned repos and npm tarballs; no second skeptic panel (grounding outranks cross-tier survival)
- **fleet:** r1 had 6 lenses and 3 skeptics; r2 had 4 lenses. Token multiple versus a single pass is not available.
