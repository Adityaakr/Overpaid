# Overpaid

**AI agents that find the money your statements are hiding, and only get paid when they deliver.**

Overpaid reads a bank or card statement, finds what is quietly costing you (recurring charges, price rises, duplicate charges, fees, forgotten subscriptions), tells you exactly what to do about each one, and drafts the messages to send. Every agent in the system, including Overpaid itself, is paid through escrow or per request on Cardano, so nobody is paid for work that wasn't delivered.

It runs three ways: a **website** anyone can use with their own statement, a **Coworker on Sokosumi** that companies hire per Task, and an **x402 endpoint** other agents pay per request.

Built for the TOKEN2049 Origins Hackathon (Singapore, October 2026). Cardano preprod only, no real money.

![Overpaid architecture](docs/diagrams/architecture.svg)

## The problem

**1. Money leaks through inattention, and businesses count on it.**
- 42% of people had forgotten they were still paying for a subscription.
- People underestimate their monthly subscription spend by $133 [1].
- 43% of US adults hold unused gift cards or store credit, $244 on average [2].
- Each item is too small to chase, so nobody chases it.

**2. Getting it back is made hard on purpose.** In a 2024 review of 642 subscription sites and apps, nearly 76% used at least one possible dark pattern, and nearly 67% used several [3]. The US click-to-cancel rule was vacated in July 2025, and the FTC only reopened the rulemaking in 2026 [4].

**3. Agents could do this work, but nobody can trust them with money.** Hidden instructions on web pages got 4 of 26 AI models to make payments [5]. An agent that reads merchant pages and holds a wallet is a liability.

**4. Hiring an agent you don't know is a gamble.** Pay first and the work may never arrive. Pay after and the agent carries the risk. Without escrow, agent-to-agent work doesn't happen.

## The solution

| Problem | What Overpaid does |
|---|---|
| Leaks nobody notices | **Audit** reads any bank or card export and prices every recurring charge per year, flags price rises, duplicate charges and fees, and keeps rent and loans out of the actions. Every figure cites the exact statement rows. |
| Nobody knows what to do next | Each finding comes with a concrete action, and Claude drafts a message to each merchant or bank. The model writes words only; it can't change a number. |
| Cancelling is a maze | **Fix** runs Claude browser agents on merchants' own sites, stopping before anything irreversible for a one-tap human approval. An outcome only counts once the merchant's status page confirms it. |
| Agents can't be trusted with money | Browsing agents **hold no keys and have no payment tools**. Users sign their own money in their own wallet. Page text is treated as data, not instructions. |
| Hiring strangers is a gamble | Agents are paid **through Masumi escrow on Cardano**: the fee locks when work starts, the result hash goes on chain, and the buyer can dispute or is refunded if nothing arrives. One-off purchases are paid per request over **x402**. |
| Small bills aren't worth anyone's time | **Bargain** pools people who overpay for the same thing: members pledge into an Aiken contract, providers bid, and one transaction pays the winner and refunds everyone the difference. |

Overpaid charges only on money that comes back, paid from the user's own wallet after the recovery is confirmed. Bill negotiation services charge 33% to 60% of savings for comparable work [6].

## Try it

| Who | How | What happens |
|---|---|---|
| **A person** | Open **`/audit`** on the website and drop in a bank or card CSV | A free dashboard of everything worth acting on. Pay 2 tADA from your own wallet over x402 to unlock the reasons, source rows, actions and drafted messages. |
| **A company** | On Sokosumi, create a Task for **Overpaid Recovery Auditor** (Coworker `01a11413-db1e-7259-ab91-17a7ef2f9c77`) and paste the statement | The Coworker requests payment into Masumi escrow, runs the audit, puts the result hash on chain and posts the report in the Task thread. |
| **Another agent** | `POST /api/x402/audit` with `{ "statement": "..." }` | `402 Payment Required` with the price; any `@x402/cardano` client pays and retries. No account, no API key. |

### What a real statement gets you

A three-month bank export (44 rows, money out as negative amounts, plain descriptions like "Cloud hosting subscription"):

| Finding | Type | Per year | What to do |
|---|---|---|---|
| Electricity, about $78.78 a month | Bill to renegotiate | $945.36 | Compare plans or ask for a retention offer |
| Internet, $54.90 a month | Bill to renegotiate | $658.80 | Compare plans or ask for a retention offer |
| Cloud hosting, $49.00 a month | Subscription to review | $588.00 | Confirm someone uses it; cancel if not |
| Mobile plan, $32.00 a month | Bill to renegotiate | $384.00 | Compare plans or ask for a retention offer |
| Software, $20.00 a month | Subscription to review | $240.00 | Confirm someone uses it; cancel if not |

**$2,816.16 a year to cut or review.** Rent ($1,350 a month) is listed as a fixed cost and kept out of the actions; salary and other income are ignored. The paid version adds the three source rows behind each line and a drafted message to each provider.

The audit reads comma, semicolon, tab and pipe exports; US and European number and date formats; signed amounts, debit and credit columns, `(12.30)` and `45.00 CR`; and dozens of common header names. A statement shows what you pay, not whether you use it, so recurring charges are listed **to review**, never claimed as unused.

## Proven on Cardano preprod

**Verified** means it ran end to end, with the transactions linked. **Documented** means the vendor API is confirmed against its official docs but we haven't run it yet.

### 1. Recovery audit on Sokosumi: verified

The **Overpaid Recovery Auditor** Coworker is registered on the Masumi registry ([4b35caa7](https://preprod.cardanoscan.io/transaction/4b35caa729241774d84e3c916e8ced2488dbe51ff4544dd3b9b43ee16b05edb1)), approved for the TOKEN2049 event workspace, and paid 1 test USDM per Task through Masumi escrow.

| Paid Task, start to payout | Transaction |
|---|---|
| Escrow funded by Sokosumi from the team's credits | [6a95b180](https://preprod.cardanoscan.io/transaction/6a95b180a71b15ce99b1392e5a9673c7931e60611e07886f6c97cf9d1c48076c) |
| Result hash on chain | [85367bdd](https://preprod.cardanoscan.io/transaction/85367bddeae072f03632a483cb7d7d55a5bdbdf50614b7ee3a39293cbeadb9cd) |
| Payment collected: exactly 1.000000 test USDM net to the seller wallet, measured on chain | [b8a45261](https://preprod.cardanoscan.io/transaction/b8a45261fc1c2984cfdd066af69d58df58c45771bdb5bb8983b5774180fb2bb3) |

A second paid Task ran in the TOKEN2049 workspace: escrow [5d063cd5](https://preprod.cardanoscan.io/transaction/5d063cd5757cb8c631622ea64289b7df91d15a7b40111222c1ec82175d8607e3), result submitted and confirmed, Task completed. Setup, every ID and the problems we hit are in [docs/COWORKER.md](docs/COWORKER.md).

### 2. Pay-per-request audit over x402: verified

The website and the agent endpoint sell the same audit per request. The server builds the payment, the buyer's wallet signs it, and our keyless in-process facilitator verifies and submits it before the result is released.

| Buyer | Payment |
|---|---|
| A person, in the browser, with their own wallet and their own bank export | [e78b53ad](https://preprod.cardanoscan.io/transaction/e78b53ada7a7788465ca40ec1b125dc55295d030b20af8aaf54d2b039a1f04d8), [37a4da9a](https://preprod.cardanoscan.io/transaction/37a4da9afe6306dc50a4c8d37da264b2465a9289a05d104b80ea84976403618b) |
| An agent using the standard `@x402/cardano` client | [de247548](https://preprod.cardanoscan.io/transaction/de24754864944da37b2bc0854fa312a800719952a4b192b4c30e878375afb8de) |

If the response is lost after payment, the page recovers the paid result with a private claim id. A retry can't charge twice, because each payment spends one specific UTxO.

### 3. Expert claims through a hired specialist: verified

Some claims need know-how, like a delayed flight the airline's form rejects unless you pick the right category. Overpaid hires a specialist agent over x402 into Masumi escrow. The specialist files the claim, waits until the airline shows "Compensation paid" and puts its evidence hash on chain. Overpaid re-checks the status page and the hash before letting the fee release, and disputes automatically on a mismatch.

| Step | Transaction |
|---|---|
| Escrow lock | [26ba25f4](https://preprod.cardanoscan.io/transaction/26ba25f48d920d4f522d6625ac69d5d98045b929565cad5727f28278cb899797) |
| Evidence hash | [8b690eb4](https://preprod.cardanoscan.io/transaction/8b690eb460ff1eb9adebc68538ee22cc477a233c858e6292f47741754ab1e89d) |
| Fee collected | [3fc5a9c2](https://preprod.cardanoscan.io/transaction/3fc5a9c215e17d915f75d0ab85a265d73f11d2e900ec320a8a69db6507036df2) |

Both refund paths are proven too: no result leads to a buyer refund, and a disputed result leads to a seller-authorised refund ([docs/PROGRESS.md](docs/PROGRESS.md)). The airline is a demo merchant and the specialist is built by our team; both are labelled in the app.

### 4. Group bargaining: verified

| Step | Transaction |
|---|---|
| Pledge signed in the user's own wallet (Lace, Eternl, any CIP-30) | [a7ba2fb6](https://preprod.cardanoscan.io/transaction/a7ba2fb674794eec5aff7ed70672ac2802048534804b580a016e129a9fcc0f1a) |
| Self-service refund to the same wallet | [0569c611](https://preprod.cardanoscan.io/transaction/0569c6114bededff467196b49d556d1d3e7d24058f2f366e72c4e7b8ddd97871) |
| 30 pledges settled atomically: one transaction pays the provider and refunds every member | [01362f7d](https://preprod.cardanoscan.io/transaction/01362f7d133499769bb93a08136093bbb7aa9819716fd2ebc7bdf96d0bae0ff7) |

Providers are simulated today.

### 5. Proving "unused" with the vendor's own data: documented, next

A statement can't tell whether a seat or key is used. Vendor admin APIs can:
- **OpenRouter** reports usage per day, week and month for every key, and can disable one [7].
- **OpenAI** project keys carry `last_used_at` [8].
- **GitHub Copilot** seats carry `last_activity_at` and can be cancelled through the API [9].
- **Google Workspace** reports each user's last login, and its licensing API can remove a seat [10].

The Coworker would read with a read-only token, post a priced proposal in the Task thread, and act with a narrower write token only after a human approves. Plan and trust rules: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## What is real and what is demo

| Real | Demo or simulated, labelled in the app |
|---|---|
| **Your upload** on `/audit` or in the app's Connect page, and every finding it produces | **"Use demo data"**: a synthetic account with receipts and a statement |
| **The Coworker** on Sokosumi: Tasks, escrow, result hashes, payout | **Fix agents** operate only on our four demo merchant sites. On real uploads they never run; real lines are marked "Your action" with a concrete step instead. |
| **Every x402 payment, pledge, refund, settlement, success fee and registration** on preprod | **The specialist** files on a demo airline |
| **Wallets**: users sign their own transactions in Lace, Eternl or SubWallet | **eSIM providers** and 60 of the pledges are simulated; the room's custodial demo wallets are run by Overpaid |

## Why the claims hold up

| What matters | How |
|---|---|
| **Quality of results** | Findings come from a deterministic engine with 62 tests across real export formats; every figure cites its rows. Claude drafts only the messages. Fix outcomes are read from the merchant's status page; specialist evidence is re-hashed before the fee releases. |
| **Usefulness** | One upload gives a person or a finance team a ranked list of actions with yearly values and messages ready to send. The human approves irreversible steps. |
| **Reliable execution** | Every paid step is saved before it is sent; an uncertain write is never retried blindly, so there's no double run and no double charge. A connection refused before sending is rolled back and retried safely. A payment that can't be confirmed closes the Task as FAILED with the reason, and no unpaid work is delivered. A watchdog restarts the payment node when its chain sync goes stale, and a supervisor restarts it if it crashes. |
| **Verified payment** | For the Coworker, Sokosumi's receipt says `settled`, the payment node's withdrawal matches it, and Blockfrost shows the seller address gained exactly 1 test USDM ([b8a45261](https://preprod.cardanoscan.io/transaction/b8a45261fc1c2984cfdd066af69d58df58c45771bdb5bb8983b5774180fb2bb3)). |

## How it works

| Part | What it does |
|---|---|
| **Find** (`packages/find`) | Parses `.eml`/`.mbox` receipts and CSV or PDF statements in any common bank format, detects recurring charges, and runs six detectors: forgotten subscription, duplicate charge, price drop, undelivered order, flight compensation, bill above market. |
| **Audit** (`services/coworker/src/audit.ts`) | Prices every recurring charge per year, categorises it (subscription, bill, fixed cost), catches price rises on plans, same-day and near-duplicate charges and bank fees, and attaches an action and source rows to each. Shared by the website, the app, the Coworker and the x402 endpoint. |
| **Fix** (`services/fleet`) | Claude tool loop (OpenRouter, Bedrock or the Anthropic API) in local Chromium or AgentCore Browser. Every request carries `X-Overpaid-Agent`. |
| **Hire** (`services/specialist`, `packages/cardano`) | The specialist is an x402 `masumi` seller with a MIP-003 API and its own wallet. The buyer side verifies the quote, locks escrow, verifies the result and disputes automatically on a mismatch. |
| **Bargain** (`services/bloc`, `contracts/bloc`) | One Aiken validator with spend, withdraw and publish handlers. A withdraw-zero settlement checks the whole batch at once, which fits 40 pledges per transaction. |
| **Coworker** (`services/coworker`) | A Sokosumi worker for both the personal and event workspaces, a local Masumi payment service for signed terms, escrow and collection, and a MIP-003 agent API for the registry listing. |
| **x402 audit** (`services/api/src/routes/x402audit.ts`) | Free preview, the paid resource behind a 402, wallet build and assemble helpers, and claim-based recovery of paid results. |

Step-by-step flows: [docs/COWORKER.md](docs/COWORKER.md) (paid Task sequence) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (components, keys, escrow states).

## Quickstart

Needs Node 22+, pnpm and Postgres.

```bash
pnpm install
npx playwright install chromium
createdb overpaid && pnpm db:migrate
cp infra/env/.env.example .env
npx tsx scripts/gen-wallets.ts      # preprod seeds into .env.wallets (gitignored)
pnpm demo:data                      # synthetic receipts and statement
pnpm dev
```

- **Your own statement:** open http://localhost:3000/audit and drop in a CSV, or upload it in the app's Connect page.
- **The demo:** open http://localhost:3000/app, choose **Use demo data**, then **Approve and fix**. `pnpm demo:check` runs every milestone check.

Optional keys in `.env`:

- **`BLOCKFROST_PROJECT_ID`** and funded wallets (`npx tsx scripts/wallets.ts` prints the addresses): x402 payments, specialist hires and the bloc on preprod.
- **`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` or AWS credentials:** drafted messages and agent mode. Without them, messages use templates and the fleet replays recorded paths, labelled "scripted".

To run your own Coworker with its payment node, see [docs/COWORKER.md](docs/COWORKER.md).

## Repository

```
apps/web             landing page, /audit, product app, /join for phones
services/api         orchestrator, ledger, events, hires, fees, x402 audit
services/fleet       browser fleet and Claude agent loop
services/merchants   four demo merchant sites
services/specialist  x402 + Masumi specialist agent
services/bloc        bloc campaigns, pledges and settlement
services/providers   simulated bidder agents
services/coworker    the audit engine and the Sokosumi Coworker (worker, agent API, registration)
packages/find        Find pipeline and statement parsers
packages/cardano     wallets, escrow transactions, x402 buyer and facilitator
contracts/bloc       Aiken contract and tests
scripts/diagrams     hand-drawn diagrams (pnpm diagrams)
docs/                architecture, implementation, Coworker, progress, pitch
```

## References

1. C+R Research, 2022 (n=1,000), via Nasdaq: https://www.nasdaq.com/articles/subscriptions-are-hard-to-cancel-and-easy-to-forget-by-design
2. Bankrate, gift card survey, 2024: https://www.bankrate.com/credit-cards/news/gift-cards-survey/
3. FTC, ICPEN and GPEN, review of dark patterns in subscription services, July 2024: https://www.ftc.gov/news-events/news/press-releases/2024/07/ftc-icpen-gpen-announce-results-review-use-dark-patterns-affecting-subscription-services-privacy
4. Crowell & Moring on the click-to-cancel vacatur and the 2026 rulemaking: https://www.crowell.com/en/insights/client-alerts/clicking-all-the-right-boxes-ftc-moves-to-revive-click-to-cancel-rule-following-eighth-circuit-vacatur
5. Zscaler ThreatLabz, indirect prompt injection in web content, July 2026: https://www.zscaler.com/blogs/security-research/indirect-prompt-injection-web-content-targets-ai-agents
6. CNBC Select, bill negotiation services: https://www.cnbc.com/select/best-bill-negotiation-services/
7. OpenRouter, API key management: https://openrouter.ai/docs/features/provisioning-api-keys
8. OpenAI, project API keys: https://developers.openai.com/api/reference/resources/organization/subresources/projects/subresources/api_keys
9. GitHub, Copilot user management API: https://docs.github.com/en/rest/copilot/copilot-user-management
10. Google Workspace, Reports API user usage: https://developers.google.com/workspace/admin/reports/v1/guides/manage-usage-users and License Manager API: https://developers.google.com/workspace/admin/licensing/reference/rest/v1/licenseAssignments/delete
11. Masumi documentation: https://docs.masumi.network and Sokosumi: https://preprod.sokosumi.com
12. x402 on Cardano: https://developers.cardano.org/x402

## Credits

Masumi `vested_pay` v2 escrow, payment service and Sokosumi · Anastasia Labs `aiken-design-patterns` (MIT) · Actual Budget `findSchedules` (MIT) · AWS `bedrock-agentcore` samples (Apache-2.0) · x402 (Apache-2.0) · the Cardano Foundation x402 demo, read for reference · rough.js for the diagrams · the Makro Framer template for the landing design.

Not legal advice. Preprod only.
