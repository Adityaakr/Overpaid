# Progress

Status updates per milestone: what is done and the proof, what is next, risks, and what is needed.

## 6 Oct 2026, M1 Find and M2 Fix (local fallback)

- **Done.** `check-find` passes: the ledger has the 8 expected fixes plus the eSIM bloc candidate, $1,086.90 on the table, built in 74 ms from 223 receipts and 306 statement lines. `check-fix` passes three runs in a row: 7 fleet tasks done on the four demo merchants, 7 approvals, 7 evidence hashes, $249.12 recovered and confirmed on each merchant's own status page; the flight claim is routed to the specialist.
- **Mode.** No model credentials on the build machine, so the fleet ran in scripted mode on local Chromium, labelled "scripted" and "Local Chromium (fallback)" on screen. The agent mode and the AgentCore provider are built and unit tested, not yet run against AWS.
- **Also done.** Bloc contract: `aiken check` 90/90, measured cost about 0.3M memory per pledge, recommended `N_max` 40 (to confirm on preprod). Demo merchants: 19 Playwright tests, every recipe three times in a row.
- **Next.** Specialist and Cardano package (in progress), bloc service and providers (in progress), then M3 and S1 on preprod.
- **Needs.** AWS credentials, a Blockfrost preprod key, faucet funding, a fixed public hostname.

## 6 Oct 2026, every part built; on-chain paths waiting for keys

- **Done.** All eight services run together (`/app/control` shows every one green). 203 TypeScript tests and 90 Aiken checks pass; every package typechecks.
- **Specialist.** Off-chain half proven: `services/specialist/scripts/dry-run-work.ts` filed the Skylane claim in 0.4 s, observed "Compensation paid" ($400.00) after 90.6 s, and hashed the evidence bundle. Fixed a bug where the watcher's status poll lacked the demo session cookie and would never have seen the payment. Escrow tx builders (SubmitResult, Withdraw, SetRefundRequested, WithdrawRefund, AuthorizeRefund) pass 42 offline tests. The API pays, follows the escrow and re-verifies the status page and evidence hash before counting the money.
- **Bloc.** Service, providers and settlement planner done (27 tests). `scripts/capacity.ts`: 40 pledges = 70.7% of memory, 7.8 KB with a reference script; hard maximum 53; `N_max` = 40.
- **Next.** With a Blockfrost key and funding: `check-x402`, `check-masumi`, refund paths (a) and (b), a long-timer collection, then campaign, pledges and one settlement of 40 on preprod. With AWS: agent mode, AgentCore sessions and the live-view port.
- **Needs.** Blockfrost preprod key; faucet funding (buyer and seller about 20 tADA each, bloc admin about 40, treasury about 1,400 for 300 simulated pledges, room wallets 5 each); AWS or Anthropic credentials; a fixed tunnel hostname.
