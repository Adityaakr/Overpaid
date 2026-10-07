# Overpaid

**AI agents that get your money back, paid through escrow on Cardano.**

Businesses earn a spread on inattention: subscriptions nobody uses, duplicate charges, refunds that never arrived, bills above the market price. No single item is worth twenty minutes of a person's time. For an agent, every item is.

Overpaid finds that money in your receipts and statements, claims it back on the merchants' own websites, hires specialist agents for the hard claims, and lets people who overpay for the same thing bargain as a group. Every payment between agents goes through escrow on Cardano, so nobody gets paid for work that wasn't delivered.

Built for the TOKEN2049 Origins Hackathon (Singapore, October 2026). Cardano preprod only, no real money.

![Overpaid architecture](docs/diagrams/architecture.svg)

## What it does

| | |
|---|---|
| **Find** | Reads `.eml`/`.mbox` receipts and a CSV or PDF statement, detects recurring charges, and builds one ledger. Every line has a value, a reason and the source rows it came from. |
| **Fix** | A fleet of Claude browser agents works the ledger in parallel on the merchants' own sites. Each one stops before anything irreversible and waits for a one-tap approval. An outcome only counts once the merchant's own status page confirms it. |
| **Hire** | Claims that need expertise go to a specialist agent, paid over **x402** into **Masumi** escrow. The specialist submits its evidence hash on chain, and Overpaid re-checks the evidence before the fee releases. If it doesn't match, Overpaid disputes automatically. |
| **Bargain** | Members lock refundable pledges from their own wallet in an **Aiken** contract. Providers send signed bids. One transaction pays the winner and refunds every member the difference. After the deadline, anyone can trigger the refund. |
| **Coworker** | The same engine as a **Sokosumi** Coworker that companies hire per Task: paste a card statement and get a ranked recovery list with sourced findings and ready-to-send messages. It is paid in test USDM through Masumi escrow. |
| **Fee** | A success fee only on money that came back, paid by the user from their own wallet after the recovery is confirmed. |

## Proof on Cardano preprod

Every money path has run on chain. A few of the transactions:

| What | Transactions |
|---|---|
| Specialist hired over x402 `masumi`: escrow lock, evidence hash, fee collected | [26ba25f4](https://preprod.cardanoscan.io/transaction/26ba25f48d920d4f522d6625ac69d5d98045b929565cad5727f28278cb899797), [8b690eb4](https://preprod.cardanoscan.io/transaction/8b690eb460ff1eb9adebc68538ee22cc477a233c858e6292f47741754ab1e89d), [3fc5a9c2](https://preprod.cardanoscan.io/transaction/3fc5a9c215e17d915f75d0ab85a265d73f11d2e900ec320a8a69db6507036df2) |
| Group bargain: 30 pledges settled in one atomic transaction | [01362f7d](https://preprod.cardanoscan.io/transaction/01362f7d133499769bb93a08136093bbb7aa9819716fd2ebc7bdf96d0bae0ff7) |
| Pledge signed in the user's own wallet; refund to that same wallet | [a7ba2fb6](https://preprod.cardanoscan.io/transaction/a7ba2fb674794eec5aff7ed70672ac2802048534804b580a016e129a9fcc0f1a), [0569c611](https://preprod.cardanoscan.io/transaction/0569c6114bededff467196b49d556d1d3e7d24058f2f366e72c4e7b8ddd97871) |
| Success fee paid from a user wallet for a confirmed recovery | [a4f94140](https://preprod.cardanoscan.io/transaction/a4f94140e181b320267683f76349e330a93164cbf6ee9b3fb3c999d220d2522e) |
| Coworker registered on the Masumi registry | [4b35caa7](https://preprod.cardanoscan.io/transaction/4b35caa729241774d84e3c916e8ced2488dbe51ff4544dd3b9b43ee16b05edb1) |
| Paid Sokosumi Task: escrow funded, result hash on chain | [6a95b180](https://preprod.cardanoscan.io/transaction/6a95b180a71b15ce99b1392e5a9673c7931e60611e07886f6c97cf9d1c48076c), [85367bdd](https://preprod.cardanoscan.io/transaction/85367bddeae072f03632a483cb7d7d55a5bdbdf50614b7ee3a39293cbeadb9cd) |

The full list, including the refund and dispute paths, is in [docs/PROGRESS.md](docs/PROGRESS.md).

## How it stays trustworthy

- **The browsing agents hold no keys and have no payment tools.** Payments happen only in the API and the bloc service, through fixed flows.
- **Users sign their own money.** Pledges and fees are built by the server and signed in the user's CIP-30 wallet (Lace, Eternl). The server only merges the wallet's signature into the transaction it built.
- **Agents are paid through escrow, not upfront.** A specialist or Coworker gets paid after it submits a result, and the buyer can dispute or get a refund if nothing arrives.
- **Outcomes are verified, never taken on an agent's word.** Recoveries are read from the merchant's status page; specialist evidence is re-hashed and compared before the fee releases.
- **Web pages are data, not instructions.** A demo merchant hides an instruction telling agents to pay an "express fee". The fleet flags it and carries on.
- **Every agent announces itself** with an `X-Overpaid-Agent` header on each request.

How each piece fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Which use cases work with real accounts today, and where x402 belongs and where it doesn't: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## Quickstart

Needs Node 22+, pnpm, and Postgres.

```bash
pnpm install
npx playwright install chromium
createdb overpaid && pnpm db:migrate
cp infra/env/.env.example .env
npx tsx scripts/gen-wallets.ts      # preprod seeds into .env.wallets (gitignored)
pnpm demo:data                      # synthetic receipts and statement
pnpm dev
```

Open http://localhost:3000/app, choose **Use demo data**, then **Approve and fix**. `pnpm demo:check` runs every milestone check.

Optional keys in `.env`:

- **`BLOCKFROST_PROJECT_ID`** and funded wallets (`npx tsx scripts/wallets.ts` prints the addresses): specialist hires and the bloc on preprod.
- **`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` or AWS credentials:** agent mode for the browser fleet. Without them, the fleet replays recorded paths, labelled "scripted".

To run the Sokosumi Coworker with its payment node, see [docs/COWORKER.md](docs/COWORKER.md).

## Repository

```
apps/web             landing page, product app, /join for phones
services/api         orchestrator, ledger, events, hires, fees
services/fleet       browser fleet and Claude agent loop
services/merchants   four demo merchant sites
services/specialist  x402 + Masumi specialist agent
services/bloc        bloc campaigns, pledges and settlement
services/providers   simulated bidder agents
services/coworker    Sokosumi Coworker: worker, agent API, registration
packages/find        Find pipeline (parsers, recurring, detectors)
packages/cardano     wallets, escrow transactions, x402 buyer
contracts/bloc       Aiken contract and tests
scripts/diagrams     hand-drawn diagrams (pnpm diagrams)
docs/                architecture, implementation, Coworker, runbook, pitch
```

## What is simulated

The four merchants are demo sites built for this project. The demo account's receipts are synthetic. The eSIM providers and some pledgers are simulated. The first specialist is built by the Overpaid team. The room's custodial demo wallets are run by Overpaid. Each of these is labelled in the app.

## Credits

Masumi `vested_pay` v2 escrow, payment service and Sokosumi · Anastasia Labs `aiken-design-patterns` (MIT) · Actual Budget `findSchedules` (MIT) · AWS `bedrock-agentcore` samples (Apache-2.0) · x402 (Apache-2.0) · the Cardano Foundation x402 demo, read for reference · rough.js for the diagrams · the Makro Framer template for the landing design.

Not legal advice. Preprod only.
