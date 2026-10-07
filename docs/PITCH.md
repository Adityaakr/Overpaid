# Pitch (three minutes, recorded)

One story: a real statement, audited and paid for on chain. The recording goes inside the slides; no live demo. Record the website flow twice with real test ADA and keep the cleaner take. Every number below is real; the (demo) account is not used.

## Shot list

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 | Slide: the five findings from a real three-month bank export, $2,816 a year | "This is a real bank export. Three months, 44 rows. Two thousand eight hundred dollars a year nobody is watching: hosting, software, mobile, internet, electricity." |
| 0:15 | Slide: 42% forgot a subscription, people underestimate by $133 a month (C+R Research) | "Your bank app already shows you this list. It will not price it per year, find the duplicate, or write the letter that gets it back. No item is worth twenty minutes of your time. For an agent, every item is." |
| 0:30 | Screen: `/audit`, drag the CSV in, dashboard appears | "Drop in the statement. In under a second: every recurring charge priced per year, the fees, the price rises, rent kept out of the way. Free." |
| 0:50 | Screen: scroll the ranked list, the locked panel at the bottom | "The reasons, the source rows and the letters sit behind one payment. Not a subscription. One request." |
| 1:05 | Screen: connect the wallet, "Unlock for 2 ADA" | "Connect your own wallet. No account, no card on file." |
| 1:15 | Screen: hold on the stepper and the wallet popup | "The page asks for a price over HTTP 402. My wallet signs. That is x402 on Cardano: anyone, or any agent, can pay per request with no API key." |
| 1:35 | Screen: "Verified on Cardano", click the payment pill, Cardanoscan loads | "Verified on chain before a single byte is released. Here is the transaction." |
| 1:55 | Screen: "Messages to send", copy one | "The product: a letter to each provider, ordered by money at stake, with the rows that justify it." |
| 2:15 | Slide: the Sokosumi Task thread and three hashes: escrow 5d063cd5, result, payout 479b2b1e | "The same audit is a Coworker on Masumi. A company assigns it a Task, the fee goes into escrow, the result hash goes on chain, and the fee is released: one test USDM, collected, inside the TOKEN2049 workspace. Set a schedule and it runs on every monthly export." |
| 2:40 | Slide: `POST /api/x402/audit` -> `402` -> tx de247548, then the roadmap line | "Person, company or agent: same endpoint, same price, every payment public. Next: vendor data to prove a seat is unused, and specialists we did not build, hired through the same escrow. Overpaid works for you." |

## Do not show

The browser fleet, the demo merchants, the flight-delay specialist, the bloc QR room, the Aiken contract, the (demo) ledger, the claim recovery path. Each adds a noun and none adds a payment the viewer can see. They stay in the app and the README for judges who dig.

## The three lines that matter

- "Your bank app shows what you paid. It will not price it per year, find the duplicate, or write the letter that gets it back."
- "The chain is here so you can pay for one audit from your own wallet with no account, and so an agent can do the same with no API key, with the fee held in escrow until the result is delivered."
- "Every payment, result hash and payout is a public transaction. You don't trust us; you click the link."

## Judge Q&A

- **Why not my bank app?** Apple Card in iOS 27 and the Chase app list recurring charges and alert you; Chase's guidance is to contact the merchant to cancel. Overpaid prices each charge per year, flags duplicates, fees and price rises with the rows, drafts the message, and can hire and pay a specialist only on delivery.
- **Does an agent act on my real statement?** No browser agent runs on real uploads; you get a drafted action per line. The browser fleet runs only on our demo merchants, with a human approving every irreversible step. Vendor admin APIs (Copilot seats, OpenAI keys) are the documented next step for proving "unused" and acting with a scoped token.
- **Does the fee release only when money is back?** The Coworker is paid per delivered audit through escrow: lock, result hash, release unless disputed. The success fee in the app is separate and applies only to confirmed recoveries. We never say "paid only on money that comes back" about the audit.
- **Who paid you that isn't you?** Both paid Tasks were funded from our own workspace credits, and the only x402 sellers on preprod are ours. The loop is real and self-funded; the registry listing and the event workspace approval are what make it hireable by others.
- **Double charge?** Every paid step is journaled before it is sent; uncertain writes are never retried blindly; each x402 payment spends one UTxO. A failed payment closes the Task as FAILED with no work delivered.
- **Custody?** Users sign in their own wallet. The facilitator holds no keys. Preprod only; licensing review before mainnet.
- **What is simulated?** Demo merchants, the demo account's receipts, eSIM providers, simulated pledgers, scripted fleet runs when no model is configured. Each is labelled on screen.

## Sources

C+R Research 2022 (42%, $133); FTC, ICPEN and GPEN July 2024 (76% of 642); Chase subscription fatigue guidance; Apple Wallet iOS 27 recurring charges coverage; Sokosumi Task Schedules (masumi-network/sokosumi PR 5163); AWS AgentCore Browser session recording. Links in `README.md` and `docs/POSITIONING.md`.
