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

## 6 Oct 2026, Cardano on preprod: every money path proven

Funding: faucet 10,000 tADA to the treasury, spread by `scripts/fund.ts` ([c644d916](https://preprod.cardanoscan.io/transaction/c644d916345006062194456d8de32aa353d466f4e6a36133128275133f1d7042)).

| Path | Transactions |
|---|---|
| Specialist hire over x402 masumi (`check-masumi` passed) | lock [26ba25f4](https://preprod.cardanoscan.io/transaction/26ba25f48d920d4f522d6625ac69d5d98045b929565cad5727f28278cb899797), result [8b690eb4](https://preprod.cardanoscan.io/transaction/8b690eb460ff1eb9adebc68538ee22cc477a233c858e6292f47741754ab1e89d), collect [3fc5a9c2](https://preprod.cardanoscan.io/transaction/3fc5a9c215e17d915f75d0ab85a265d73f11d2e900ec320a8a69db6507036df2). Overpaid re-checked the airline status page and the evidence hash: both matched. |
| Long-timer hire | lock [bbd95cd8](https://preprod.cardanoscan.io/transaction/bbd95cd8440f1e6e8d9e1c47eb2dff815877dc99dcfae7dc3b3e92fec7823fff), result [9369a749](https://preprod.cardanoscan.io/transaction/9369a749ee12eb78de630378b9dad519623a364f4c123111c006520e1cab3fe5), collect [252e4064](https://preprod.cardanoscan.io/transaction/252e4064826b21bb80c9ffa626272d8e04d14bf35a5b08de5b82c7fe10b1cf8f) |
| Refund path (a), no result | lock [e119483f](https://preprod.cardanoscan.io/transaction/e119483f9f723b5f74d38609e82453a0d7a9fe5ffefe59b4dae83d9f96bfb207), SetRefundRequested [9c108c0b](https://preprod.cardanoscan.io/transaction/9c108c0be6c003d9534953ce412dc39317f42f9387bb95484c533f20bc84d5ae), WithdrawRefund [40b13f57](https://preprod.cardanoscan.io/transaction/40b13f575b55d0670b341cc0d0081947966a953ab83d4b5c31bad8306db54bd4) |
| Refund path (b), result then dispute | lock [0dbe7d01](https://preprod.cardanoscan.io/transaction/0dbe7d010b0a12b0c120df1a15ff57830911c7e3e68f5cee2e09512975f4b776), result [7f144e0c](https://preprod.cardanoscan.io/transaction/7f144e0ca52a58d78f519536e846f5f701adcc35d2904bc9a967ac6377c8b40b), dispute [f23d9f64](https://preprod.cardanoscan.io/transaction/f23d9f640b7fb1aa4171491ca47301ab6659b40aa423d095ecdddde72bd653a2), AuthorizeRefund [118d512e](https://preprod.cardanoscan.io/transaction/118d512e3f37b11cd7576d798102a42bfbfd5ef4177efc9d57b917e7270f1d88), WithdrawRefund [cb6eeb51](https://preprod.cardanoscan.io/transaction/cb6eeb51f15367578269351e44be28612d08b39e9d1146ab005c630120dc1ac1) |
| Bloc campaign (NFT mint, campaign lock, stake registration) | [4898118e](https://preprod.cardanoscan.io/transaction/4898118ea73514dc7252e2d9f57e6251a13631f9a24c921f3c5488dd0ed24212) |
| 60 simulated pledges in one transaction | [d38c0be0](https://preprod.cardanoscan.io/transaction/d38c0be00155bc5f6226e1b5aec3d5f082b38a2c9e47acce0d1c40001ee7eb6d) |
| Settlement, 30 pledges at 1.47 tADA, atomic | [01362f7d](https://preprod.cardanoscan.io/transaction/01362f7d133499769bb93a08136093bbb7aa9819716fd2ebc7bdf96d0bae0ff7) |
| Settlement, 30 pledges at 1.38 tADA, atomic | [9b1f0e2a](https://preprod.cardanoscan.io/transaction/9b1f0e2a98b385bde870df7a70be3bc3d80593a8a37e4c6d8234d86ae6be40fb) |

Bugs found and fixed on the way: the API read the specialist's job view with the wrong field names; a re-run of Find could revive fixed ledger lines and create duplicate tasks; later "done" events could erase confirmation codes; batch two of a settlement reused a stale UTxO snapshot (now re-read per batch).

Still open: a settlement of exactly `N_max` = 40 pledges, real room pledges through `/join` (needs a public hostname), agent mode and AgentCore (needs AWS or Anthropic credentials), Masumi registry registration (needs the hostname).

## 7 Oct 2026, real users on preprod: own wallets, success fees, hardened flows

| Path | Transaction |
|---|---|
| Success fee paid from a user wallet for a confirmed $400 recovery (6 tADA) | [a4f94140](https://preprod.cardanoscan.io/transaction/a4f94140e181b320267683f76349e330a93164cbf6ee9b3fb3c999d220d2522e) |
| User-signed bloc pledge through the product API, refund address = the user | [a7ba2fb6](https://preprod.cardanoscan.io/transaction/a7ba2fb674794eec5aff7ed70672ac2802048534804b580a016e129a9fcc0f1a) |
| User-signed pledge (bloc service) | [791a0b9f](https://preprod.cardanoscan.io/transaction/791a0b9f1879bda45c49a86e898798339fead29a88a4844fe309b8db100aa615) |
| Self-service refund signed by the user | [0569c611](https://preprod.cardanoscan.io/transaction/0569c6114bededff467196b49d556d1d3e7d24058f2f366e72c4e7b8ddd97871) |
| Automatic refunds after the deadline | [f827c154](https://preprod.cardanoscan.io/transaction/f827c154110156352c041b73607174ec9677cc4435ea053bad61f72152baed2a), [bb6f60f0](https://preprod.cardanoscan.io/transaction/bb6f60f0ee16661e4c25f3cd3987f894483777cdd2f4f3d2f2c91988c9472233), [1ee2bc78](https://preprod.cardanoscan.io/transaction/1ee2bc786ca447bce648c190fbcfe8818891d6bbd20ce6b6a9984a0afaf0e456) |
| Hardened hire: lock, result, verified, collected | [33600ae7](https://preprod.cardanoscan.io/transaction/33600ae715d3f094fac04248be54312d4df60ba252c8164a4336502ee32e679e), [aa40d3d8](https://preprod.cardanoscan.io/transaction/aa40d3d866944f6d7f0ae515abfdbf783aeaae106f9fa3226848cd95597b48cc), collect ce3308ff |
| Specialist moved to its own seed (sweep) | [83f6b81e](https://preprod.cardanoscan.io/transaction/83f6b81e5981319e083709ce978eafef965fad4b6200cedf067161aea7a8f276) |
| Hire against the new seller; survived an API restart mid-payment | lock [ee9c0c33](https://preprod.cardanoscan.io/transaction/ee9c0c332f90), result [335ad843](https://preprod.cardanoscan.io/transaction/335ad843890f), verified |
| Specialist listed on the Masumi preprod registry (agent NFT minted by its seller wallet) | [92fac474](https://preprod.cardanoscan.io/transaction/92fac474f90b1070ddd11500756748ff12cd22dde682fe524b7f3846f3bea973) |

Also: CIP-30 wallet connect in the app (Lace, Eternl), a wallet page with on-chain history, API write guard and operator token, public access through a tunnel with remote writes limited to wallet pledges, refunds and fees.

Agent mode: the fleet ran all seven fix tasks with Claude Sonnet 5.5 through OpenRouter (87 tool calls, seven approvals, seven recoveries verified on the merchants' status pages, $249.12). It flagged and ignored the hidden "pay the express fee" instruction on the Parcelo page.

Still open: a real browser wallet extension run (signing is proven with a seed wallet emitting the same CIP-30 witness sets), AgentCore (needs AWS). The registry listing points at a quick tunnel URL, which changes if the tunnel restarts; a named tunnel would fix it.
