# Overpaid build plan

Overpaid (formerly Ombud; renamed 6 October 2026, see DECISIONS.md D1) finds money people are owed and gets it back: Find, Fix, Bargain, with specialist hires and bloc settlement on Cardano preprod. Scope, facts and process come from `docs/BRIEF.md`; this file is the working plan.

## Milestones and order

| # | Milestone | Depends on | Check | Status |
|---|---|---|---|---|
| B0 | Bootstrap: workspace, Postgres, shared types, env templates, seeds | none | `check-bootstrap` | done |
| R | Research: CF masumi seller, vested_pay v2, AgentCore sample, facilitator, Aiken patterns | none | notes in `docs/research/` | done |
| A | Spike A: x402 default payment on preprod | Blockfrost key, funded buyer | `check-x402` | blocked on keys |
| B | Spike B: specialist registered + masumi lock + result (critical path) | Blockfrost, funded wallets, public hostname | `check-masumi` | blocked on keys |
| C | Spike C: AgentCore 8 sessions + live view in ap-southeast-1 | AWS credentials | `check-fleet` | blocked on keys; local Chromium fallback first |
| M1 | Find: dataset, pipeline, ledger UI, under 60 s | B0 | `check-find` | done (74 ms) |
| M2 | Fix: 4 demo merchants, recipes, fleet grid, approvals, evidence, counter | B0, C (or local fallback) | `check-fix` | done in scripted mode, 3 runs; agent mode needs AWS |
| M3 | Specialist hire end to end, refund paths (a) and (b), escrow timeline UI | B, M2 airline | `check-masumi` | built; off-chain proven; on-chain needs keys |
| S1 | Bloc: Aiken contract + tests, capacity, providers, x402 script pledges, room, settlement | M1 to M3 green | `check-bloc` | built; N_max 40 measured offline; on-chain needs keys |
| S2 | Signed agent identity (Web Bot Auth) or plain agent header | C | part of `check-fix` | later |
| D | Docs: README, ARCHITECTURE, RUNBOOK, PITCH, SUBMISSION | all | review | drafted |

Critical path: B (masumi lock and collection) needs a funded seller and buyer on preprod plus a fixed public URL for the registry. Everything that does not need keys is built now so the keys unlock spikes immediately.

## Work split

- Orchestrator (me): shared types, database, API and orchestrator, event stream, product app screens, Cardano integration, integration of every part, checks and docs.
- Build agents in parallel: demo merchants (`services/merchants`), Find pipeline and dataset (`packages/find`, `data/demo`), then the fleet runner, the specialist, the bloc contract.

## Ports

web 3000, api 4000, merchants 4101 to 4104, specialist 4200, bloc 4300, providers 4400.

## Risks

1. No credentials yet (AWS, Blockfrost, tunnel). Mitigation: build keyless parts first; local Chromium fallback for the fleet; Yaci or Aiken unit tests for the contract.
2. No Docker or Java on the build machine: Postgres runs natively (Homebrew), the facilitator uses the CF hosted preprod facilitator unless a JDK is installed.
3. Escrow windows are long (collection at least about 60 minutes after the lock): start long-timer hires early, always.
4. Bloc capacity is unmeasured: measure `N_max` before promising any number.
