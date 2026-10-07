# Submission

## Clawback: AI agents that get your money back

Clawback reads your receipts and card statement, finds money businesses keep from people too busy to chase it, and claims it back on the merchants' own websites with a fleet of browser agents. Claims that need expertise go to a specialist agent paid through Masumi escrow on Cardano over x402. Overpaying users bargain as a bloc, with pledges locked in an Aiken contract and a single settlement transaction that pays the winning provider and refunds everyone the difference.

## What is real

- The Find pipeline (parsers, recurring-charge detection, six vigil detectors) on real `.eml`, `.mbox`, CSV and PDF files.
- The fleet: parallel browser sessions, a Claude tool loop with no payment or evaluate tools, approvals for irreversible steps, verification on merchant status pages, hashed evidence bundles.
- The specialist hire on Cardano preprod: x402 `masumi` lock into Masumi's `vested_pay` v2, our own SubmitResult, Withdraw, SetRefundRequested, WithdrawRefund and AuthorizeRefund transactions.
- The Aiken bloc contract (90 tests) and its settlement and refund transactions on preprod.

## What is simulated, and labelled

The four merchants are demo sites built for the hackathon. The demo user's receipts are synthetic. The eSIM providers and some pledgers are simulated. The specialist is first party. When no model credentials are configured, fleet runs use recorded scripted paths and say so.

## Tracks

Main track (AWS: Bedrock AgentCore Browser, Bedrock Converse). Cardano Agentic Commerce: x402 payments, Masumi escrow and registry, spending control, trust and reputation through on-chain escrow outcomes, new sellers.

## 90-second video script

1. (0-10 s) Title card, the opening stat.
2. (10-25 s) Find: total and ledger.
3. (25-50 s) Fix: eight tiles, approvals, counter.
4. (50-70 s) Specialist: escrow timeline, lock, result, collection with CardanoScan links.
5. (70-85 s) Bloc: pledges landing, settlement transaction.
6. (85-90 s) Close line.
