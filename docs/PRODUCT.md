# Ombud product plan (condensed)

> Condensed from the original planning document. Where this file and `docs/BRIEF.md` disagree, the brief wins; `docs/REVIEW.md` lists every correction and its source. Known-wrong claims in this file: the 95/5 Masumi fee, "request a refund before unlock and get the fee back" after a result is submitted, "100 pledges per transaction", "all or nothing across several transactions", Lucid/Mesh as the tx library, the Android Headlines source and the Amazon paraphrase.

Event: TOKEN2049 Origins Hackathon, Singapore, 6–8 Oct 2026 (36h build). Tracks: Main + Cardano: Agentic Commerce.
Built on: Cardano x402, Masumi (escrow + registry), Aiken, Amazon Bedrock AgentCore Browser. No code yet; code starts at kickoff.

## Product
Agentic cloud browser reclaiming money businesses keep from consumer inattention.
- FIND: ingest .mbox/.eml receipts + card statement CSV/PDF; model-assisted extraction; match against a merchant policy library; ledger "money on the table".
- FIX: orchestrator turns approved ledger lines into browser tasks; each task in its own cloud browser session (AgentCore Browser, Browserbase fallback), parallel (target 8). Per-merchant recipes. User signs in once per merchant via live view. End states: done/needs approval/needs specialist/failed.
- BARGAIN: group users paying for the same thing (MVP: travel eSIM for attendees). Each member pledges refundable deposit on Cardano up to current price; provider agents see pledged demand on chain, submit signed bids; best bid wins; one settlement pays provider for every member and refunds each the difference. No bid by deadline -> all refunded.

## Evidence claims (with cited sources)
- C+R Research 2022: 42% forgot a subscription; underestimate by $133/mo. FTC/ICPEN/GPEN July 2024: 642 sites, ~76% ≥1 dark pattern, ~67% several. Bankrate 2024: 43% hold unused gift cards avg $244.
- Eighth Circuit vacated FTC click-to-cancel rule 8 July 2025; FTC submitted new ANPRM Jan 2026.
- Rocket Money 35–60% of first-year savings; Billshark 40% + $9/cancellation; Trim 33% (CNBC Select 2026).
- iChoosr UK collective switching ~£237/household, >35,000 registered (Dover council).
- Microsoft Magentic Marketplace: buyer agents accepted first proposal.
- Meta "Muse" launched 8 Sep 2026, a personal agent that opens browsers, fills forms, pays/lowers bills; top free app US App Store; up to $100/mo ($0/$20/$100 tiers); US+Canada only; Amazon blocked it from purchases (sources: Fox Business, usecarly.com blog, Android Headlines 2026/09).
- Zscaler ThreatLabz: hidden payment instructions in web pages; 4 of 26 models paid.
- FTC fined DoNotPay over "AI lawyer" claims (Feb 2025 final order).

## Architecture
Next.js app (BrowserLiveView component from AgentCore TypeScript SDK) · Ingest · Ledger (Postgres) · Opportunity engine (rules + frontier model via Bedrock) · Orchestrator (Node) · Browser fleet (AgentCore Browser; Browserbase fallback) · Evidence store · Wallet + x402 client (`@x402/cardano` + Lucid Evolution or Mesh) · Facilitator (Cardano Foundation facilitator self-hosted, or local one from "x402 Express starter") · Masumi preprod escrow contract + registry used directly as in Cardano Foundation x402 demo; self-hosted Masumi payment service for refunds · Bloc contract (Aiken) · Bloc service (Node) · demo merchants (small labelled web apps).

## Cardano design
- Claims: "Cardano is part of the official x402 standard (`@x402/cardano`), and its x402 scheme includes escrow through Masumi." x402 Cardano exact scheme has a "script transfer method" letting payments go into a contract; with script method the facilitator only checks payment goes to declared contract address and passes pledge details through unchecked.
- Specialist hire: query Masumi registry -> MIP-003 start_job -> receive x402 terms using "Masumi method", lock fixed success fee in escrow -> specialist files claim in own browser, submits result hash -> if money confirmed Ombud does nothing and escrow releases after unlock time; else Ombud requests refund before unlock time. Fee e.g. 2 USDM. submitResultTime/unlockTime "minutes in demo; Masumi defaults are hours, must confirm on preprod". Masumi contract pays 95% seller / 5% protocol fee. Disputes go to Masumi team.
- Bloc contract (Aiken): Campaign UTxO as reference input {bloc_id, item_hash, members_limit, min_group_size, bid_deadline, refund_deadline, asset}. Pledge UTxO per member {bloc_id, member_refund_address, quantity, max_unit_price}, paid via x402 script method. Bid signed by provider {bloc_id, unit_price, expiry, provider_key} with key registered as Masumi agent. Settlement: anyone builds once valid bid exists; contract checks provider sig valid, every pledge belongs to bloc, provider gets unit_price*total_qty, each member refunded (max_unit_price - unit_price)*qty. All-or-nothing. Refund: after deadline anyone returns pledge to refund address. Withdraw-zero/stake validator pattern so per-pledge cost flat and blocks double satisfaction. Target 100 pledges per settlement tx; larger blocs settle across several txs.
- Network preprod; test ADA, test USDM (Masumi test USDM used in CF x402 demo). Blockfrost.

## Trust & safety
No stored passwords; live-view sign-in; per-task session discarded. Approvals for cancellations/disputes/deposits/payments; per-day/per-payment limits. Payments only from structured x402 offers from Ombud's own services. Evidence hashes on chain. No legal advice. Demo merchants labelled.

## Demo (3 min)
Find: real $X from own inbox in <60s. Fix: 8 live browsers + recovered counter + specialist card locked->released. Bargain: QR join, "300 pledges, 3 transactions", price $A->$B. Backups: recorded runs, pre-started specialist hire, labelled simulated pledges.

## Team & 36h plan (4 people: Cardano eng, Agent eng, Product eng, Demo lead)
0–2 setup (wallets, facilitator, Masumi payment service) · 2–6 riskiest proofs (one escrow hire lock+release on preprod; one x402 script payment to bloc address; one cloud browser cancels a demo-merchant subscription) · 6–12 Find · 12–18 Fix (4 demo merchants, 8 parallel sessions) · 18–24 Specialist on Masumi · 24–30 Bloc (contract, bids, settle 100 pledges, QR join) · 30–34 polish · 34–36 rehearse.
Must: Find with real number; Fix on 4 demo merchants parallel grid; one specialist hire x402+Masumi escrow end-to-end preprod. Should: bloc with live room. Could: one real live cancellation; second specialist.

## Verify at kickoff
- self-hosted facilitator accepts x402 script-method payments to bloc address
- Masumi escrow windows settable to minutes on preprod
- one settlement tx fits 100 pledges within size/exec limits
- AgentCore Browser concurrent session limit in Singapore region enough; live view embeds
- test USDM on preprod
- specialist + provider agents registrable on Masumi preprod quickly
- organisers allow OSS libs/starter templates

## Sources referenced
x402 Cardano scheme spec: https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_cardano.md
https://developers.cardano.org/x402/
https://www.masumi.network/dev/masumi/core-concepts/payments ; .../refunds-and-disputes
MIP-003: https://github.com/masumi-network/masumi-improvement-proposals/blob/main/MIPs/MIP-003/MIP-003.md
Masumi contracts ref: https://github.com/masumi-network/masumi-skills/blob/main/skill/references/smart-contracts.md
CF demo: https://github.com/cardano-foundation/x402-cardano-demo ; facilitator: https://github.com/cardano-foundation/cardano-x402-facilitator
AgentCore live view blog: https://aws.amazon.com/blogs/machine-learning/embed-a-live-ai-browser-agent-in-your-react-app-with-amazon-bedrock-agentcore
Stake validator: https://github.com/Anastasia-Labs/design-patterns/blob/main/stake-validator/STAKE-VALIDATOR.md
Builder areas: https://github.com/cardano-foundation/developer-portal/pull/2025
Muse: foxbusiness.com/technology/metas-muse-becomes-app-stores-hottest-download ; usecarly.com/blog/meta-muse/ ; androidheadlines.com/2026/09/amazon-blocks-meta-muse-ai-agent-shopping.html
