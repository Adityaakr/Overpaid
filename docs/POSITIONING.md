# Positioning (TOKEN2049, Cardano and Masumi track)

Decision doc from a six-lens Prism run on 7 October 2026, verified by three skeptics. Short version first; the reasoning and the evidence tiers follow.

## 1. Recommendation (revised the same day)

Position Clawback as **money you're owed, recovered by AI, outcome-based**: it is about getting back what you are already losing, not managing what you have. connect once, agents watch every charge and recover what you approve, you get a review on Sunday, and you pay only on money that comes back. The per-audit paywall for people is gone; the website audit is free and ends in "Start my autopilot". The chain is where Clawback pays its own agents (specialists through Masumi escrow), where other agents buy audits per request (x402), and where companies hire it as a Coworker on a schedule.

Why the revision: the first draft (hire per job, 2 tADA per audit) made the user come back and pay every time, which contradicts the product the founder is building. Outcome-based pricing already existed in the code (15% success fee on confirmed recoveries, `services/api/src/routes/fees.ts`); the paywall was the odd one out.

Narrow the 3-minute video to one problem: **a real statement, on autopilot, with the Sunday review and one agent paid through escrow**. Cut group bargaining and the eight-browser montage.

The one-line position:

> Money you're owed, recovered by AI. Clawback finds the subscriptions, fees and overcharges you are already paying for and its agents get the money back, with your approval. A review every Sunday, a fee only when money lands.

What is true today versus next, said on every surface: today you connect by dropping in a statement export; bank and card connections, family accounts and continuous scanning are next. Browser agents act on demo merchants; on real lines you approve a drafted action.

## 1a. The original recommendation (kept for the record)

Position Clawback as **the recovery auditor you hire per job**: give it a bank or card statement and it tells you exactly what to cut, claim or renegotiate, with the source rows and the message to send. People use it on the website, companies hire it as a Coworker on Sokosumi, other agents buy it over x402. It is paid per delivered audit, through escrow or per request on Cardano, and a success fee applies only to money confirmed back.

Narrow the 3-minute video to one problem: **a real statement, audited and paid for on chain**. Demo the website unlock (one screen, one wallet popup, one explorer link). Show the Sokosumi Task as a proof card, not a second demo. Cut the browser fleet and group bargaining from the video.

The one-line position for the README and the landing page:

> Clawback audits your statement, tells you what to cut, claim or renegotiate, and drafts the messages. Hire it per audit from your wallet, or as a Coworker on Sokosumi. Every agent it pays is paid through escrow on Cardano.

## 2. Why

- **It is the only story with a complete, measured money loop.** Two paid Sokosumi Tasks ran start to payout: escrow funded, result hash on chain, exactly 1.000000 test USDM collected to our seller wallet ([b8a45261](https://preprod.cardanoscan.io/transaction/b8a45261fc1c2984cfdd066af69d58df58c45771bdb5bb8983b5774180fb2bb3), [479b2b1e](https://preprod.cardanoscan.io/transaction/479b2b1e4dc29f320bd1c8ad25fbc373738b8de7ddf4d97d3905f1a0a87a1928)), the second inside the TOKEN2049 workspace. The website sold the same audit over x402 to a person and to an agent ([e78b53ad](https://preprod.cardanoscan.io/transaction/e78b53ada7a7788465ca40ec1b125dc55295d030b20af8aaf54d2b039a1f04d8), [de247548](https://preprod.cardanoscan.io/transaction/de24754864944da37b2bc0854fa312a800719952a4b192b4c30e878375afb8de)). `verified`
- **It answers "why not my bank app" with things the code does today**, not a roadmap: recurring charges priced per year and categorised, price rises, same-day and near duplicates, bank fees, rent and loans kept out of the actions, an action and the exact rows for every item (`services/coworker/src/audit.ts`), and a drafted message per merchant. Apple Card in iOS 27 and the Chase app list recurring charges; Chase's own guidance is to contact the merchant to cancel [1][2]. `verified` (code) / `supported` (bank apps)
- **It matches what the judges asked for.** Masumi's criteria are quality of results, usefulness, reliable execution and verified payment. A hireable auditor with cited findings, journaled idempotent payments and explorer-linked collection hits all four. The browser fleet, which only runs on demo merchants, invites the "it's all fake" reaction and hits none of them.
- **"Integrate once, runs on auto" is real on the platform we're on.** Sokosumi has Task Schedules: a schedule is assigned to a Coworker, runs daily, weekly or monthly on a cron rule, and each occurrence creates a new Ready Task [3][4]. So "point it at your monthly statement export once" is a configuration, not a promise.

## 3. Why blockchain, in mechanisms

- **Escrow lets you hire a stranger per job.** The fee locks when the work starts, the result hash goes on chain, and the buyer is refunded if nothing arrives or can dispute a result. Both refund paths are proven on preprod ([docs/PROGRESS.md](PROGRESS.md)). Without this, agent-to-agent work needs a contract and an invoice. `verified`
- **x402 lets anyone pay per request with no account.** A person pays from their wallet; an agent pays with the standard client and no API key. Each payment spends one specific UTxO, so a retry cannot charge twice (`services/api/src/routes/x402audit.ts:136`). `verified`
- **Every payment, result hash and payout is public.** The judge does not trust our dashboard; they click the link. `verified`

What is still first-party, said plainly: the specialist our app hires is built by us, and the only x402 sellers on Cardano preprod we found are ours. "Agent hires agent" is real on chain and self-funded in practice. The Coworker's result hash is its commitment on chain; the Sokosumi buyer can dispute, but nobody independently re-verifies that hash today, unlike the specialist's evidence, which Clawback re-checks before the fee releases.

## 4. The three sentences for the video

- "Your bank app shows what you paid. It will not price it per year, find the duplicate, or write the letter that gets it back."
- "The chain is here so you can pay for one audit from your own wallet with no account, and so an agent can do the same with no API key, with the fee held in escrow until the result is delivered."
- "Every payment, result hash and payout is a public transaction. You don't trust us; you click the link."

## 5. Steelman of the rejected options

**Consumer "money on autopilot"** (the old landing page). Strongest case: it is the bigger market and the more exciting promise, and the Fix fleet with human approval is a real, built capability. Why we passed: on a real statement no browser agent runs (`services/api/src/orchestrator.ts:67` skips every self-serve line), the fleet works only on four demo merchants, and the audit cannot prove a subscription is unused. A judge reaches that in one question. Autopilot comes back as a roadmap item once vendor admin APIs prove non-use.

**Agent-to-agent commerce infrastructure** (sell the audit to agents over x402 as the headline). Strongest case: it is the purest Cardano story and the endpoint already works with the standard x402 client. Why we passed: one transaction and no buyer story; nobody on preprod but us is buying. It stays in as the third way in, not the headline.

## 6. Assumptions and falsifiers

- Assumes judges weight a complete paid loop over breadth. Falsified if the rubric rewards feature count; then the fleet and bloc footage goes back in as a 20-second montage.
- Assumes "Apple Card and Chase show recurring charges but don't act on them" holds. Bankrate reports Chase "will even help you cancel certain unwanted subscriptions" [5]; Chase's own page says contact the merchant [1]. We therefore never say "no bank does this", only what the specific apps document.
- Assumes the per-audit price (2 tADA) and the success fee (15% of confirmed recoveries, `services/api/src/routes/fees.ts`) can coexist in one honest pricing story: free preview, paid audit, fee on recoveries. The README and landing now say exactly that.
- Assumes the laptop-hosted payment node and tunnel stay up through judging. The supervisor and watchdog reduce the risk; hosting would remove it.

## 7. Roadmap (honest about what exists)

1. **Scheduled audits on Sokosumi.** Use Task Schedules so a company's monthly export is audited without anyone creating a Task [3][4]. Platform feature; needs only a schedule.
2. **Prove "unused" with vendor data.** OpenRouter key usage, OpenAI `last_used_at`, GitHub Copilot `last_activity_at`, Google Workspace last login, with a read token to propose and a write token to act after approval ([IMPLEMENTATION.md](IMPLEMENTATION.md)). Documented, not run.
3. **Replayable agent sessions.** Today every browser step is saved as a hashed screenshot bundle with an RFC 8785 manifest (`services/fleet/src/evidence.ts`) and there is live view. AgentCore Browser also records sessions to S3 and plays them back in the console, with human take-over during live view [6]. Turning that on gives the owner a full replay of what the agent did.
4. **Sub-agents that specialise.** The specialist hire is the pattern: Clawback pays another agent into escrow, verifies, and disputes on mismatch. Next are real third-party sellers on the Masumi registry instead of our own.
5. **Privacy.** Today the app stores uploaded rows in Postgres until the next upload (`services/api/src/find.ts:32`), the audit reads in memory and keeps paid results 24 hours under a claim id. Next: per-user storage, deletion, and redaction before any model call for the Coworker path.
6. **Cardano's agent rails.** Cardano's public AI positioning is infrastructure for agents (Masumi escrow, the agent registry, x402 on mainnet since April 2026, Veridian, Hydra) [7][8]; we found no first-party Cardano assistant competing with xAI's Grok Bot or OpenAI's Dots [9]. Clawback is a worked example of an agent that earns on those rails, and the natural next step is mainnet with USDM once the audit has paying customers.

## 8. Open questions for Aditya

- Price: resolved. People pay nothing upfront and a success fee on outcomes; agents and companies pay per request or per Task. The website audit is free.
- Hosting: run the payment node and worker on Railway before judging, or accept the laptop risk?
- Public listing: ask the Masumi team to set the Coworker visible in "Browse all agents"; it is private today.

## 9. Evidence summary

6 verified, 7 supported, 1 unverified (judge rubric weighting), 0 contradicted.

> Cross-tier verification reduces instance- and tier-level error correlation but not shared-lineage blind spots. Treat cross-tier survival as weaker evidence than grounding.

## Telemetry

- divergence: 0.65 (evidence 0.75, conclusion 0.50) | threshold 0.30 UNCALIBRATED
- grounding: n/a
- models: draft=fable · skeptics=2x-opus+1x-sonnet (cross-tier; version axis unavailable)
- claims: C1 bank apps list, don't act: cross-tier-survived (2/3, as a specific claim) · C2 Sokosumi schedules: grounded (repo PRs, organiser deck) · C3 AgentCore recording and replay: cross-tier-survived (3/3) · C4 no first-party Cardano agent: cross-tier-survived (2/3, as absence of evidence) · C5 no Fix run on real uploads, no x402 double charge: grounded
- fleet: 6 lenses + 3 skeptics · token-multiple vs single-pass ≈ 7x

## References

1. Chase, subscription fatigue: https://www.chase.com/personal/credit-cards/education/basics/subscription-fatigue
2. Apple Wallet in iOS 27, recurring charges: https://macdailynews.com/2026/09/16/apple-wallet-in-ios-27-gets-pass-creation-bill-splitting-recurring-charges-smarter-hotel-keys-and-more/
3. Sokosumi Task Schedule Manager: https://github.com/masumi-network/sokosumi/pull/5163
4. Sokosumi Task Schedules API: https://github.com/masumi-network/sokosumi/pull/5129
5. Bankrate on the Chase recurring charges tool: https://www.bankrate.com/credit-cards/advice/chase-recurring-charges-tool
6. AWS, AgentCore Browser session recording and replay: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-session-recording.html
7. Cardano and AI: https://cardano.org/ai
8. x402 on Cardano mainnet, April 2026: https://cardano.org/news/2026-04-28-community-digest/
9. Grok Bot and Dots: https://aimultiple.com/always-on-agents
