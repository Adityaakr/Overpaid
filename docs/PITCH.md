# Pitch (three minutes, recorded)

One story: money you are already losing, recovered by agents. A real statement goes in once; the agents work; you get a Sunday review; one agent is hired and paid through escrow on Cardano. The recording goes inside the slides; no live demo. Record twice, keep the cleaner take. Every number is real; the (demo) account appears only where a browser agent is shown, and is labelled.

## Shot list

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 | Slide: five findings from a real three-month bank export, $2,816 a year | "A real bank export. Three months, 44 rows. Two thousand eight hundred dollars a year nobody is watching. Your bank app shows this list. It will not price it, chase it, or write the letter." |
| 0:15 | Slide: 42% forgot a subscription, people underestimate by $133 a month | "No item is worth twenty minutes of your time. So nobody does it. For an agent, every item is worth it, every week, without you." |
| 0:30 | Screen: `/audit`, drop the CSV, the audit appears | "Connect once. Today that is a statement export; bank connections are next. Every charge priced per year, duplicates, fees, price rises, with the rows behind each one. Free." |
| 0:50 | Screen: "Draft the messages", one letter appears, click "Start my autopilot" | "The letters write themselves. Then you put it on autopilot and walk away." |
| 1:05 | Screen: `/app/review`, the Sunday review | "This is the only page you ever need to open: once a week. Recovered this week. Waiting for your approval. Keep or remove, one tap each. Everything else ran on its own." |
| 1:25 | Screen: demo account, fleet tile pausing on "Confirm cancellation", approve | "When an agent reaches something irreversible, it stops and asks. That is the whole trust model: it works, you approve." (Label: demo merchant.) |
| 1:45 | Screen: Specialist hires, the escrow lock, then the evidence hash and collection on Cardanoscan | "Some claims need an expert. Clawback hires a specialist agent and pays it from its own wallet into Masumi escrow on Cardano. The fee releases only when the result hash is on chain and verified. If nothing comes back, the money comes back. You never pay an agent yourself." |
| 2:15 | Slide: Sokosumi Task thread, Schedule set to weekly, three hashes (escrow 5d063cd5, result, payout 479b2b1e) | "For companies, the same agent is a Coworker on Sokosumi. Put it on a weekly schedule and it audits the export without anyone opening a tab. Paid per Task into escrow; one test USDM, collected, inside the TOKEN2049 workspace." |
| 2:40 | Slide: pricing and roadmap in one line | "Nothing upfront. A fee only on money confirmed back. Next: bank and family accounts for continuous watching, vendor data to prove a seat is unused, and specialists we did not build, hired through the same escrow. Clawback works for you while you are not looking." |

## Do not show

Group bargaining, the Aiken contract, the (demo) $1,086 ledger total, the agent-facing x402 endpoint beyond one line, OpenRouter or Copilot specifics. Each adds a noun; none adds to the one story.

## The three lines that matter

- "Your bank app shows what you paid. It will not price it per year, find the duplicate, or write the letter that gets it back, and it will not do it again next week."
- "You never pay an agent. Clawback pays the agents it hires, through escrow on Cardano, and only when the result is on chain. You pay a fee only on money that comes back."
- "Every hire, result hash and payout is a public transaction. You don't trust us; you click the link."

## Judge Q&A

- **Why not my bank app?** Apple Card in iOS 27 and the Chase app list recurring charges and alert you; Chase's guidance is to contact the merchant to cancel. Clawback prices each charge per year, flags duplicates, fees and price rises with the rows, drafts the message, runs agents with your approval, and hires specialists it pays only on delivery. Weekly, without you.
- **Is it really autopilot today?** The engine, the review, the approvals and the agent payments are real. The connection is a statement export today; bank and card connections are next. On real lines a browser agent visits the merchant's own site read-only, brings back the cancel page, prices and support route with a screenshot of every step, and you approve the drafted action in the Sunday review. Agents that click through to the cancellation run on our demo merchants today, because a real cancellation needs your logged-in session.
- **Why blockchain?** Three mechanisms. Escrow lets Clawback hire a stranger agent per job and get the money back if nothing is delivered. x402 lets other agents buy an audit per request with no account. Every payment is public, so the judge clicks the link instead of trusting the dashboard.
- **Who pays whom?** People: nothing upfront, 15% of confirmed recoveries. Companies: per Task into escrow on Sokosumi, or on a schedule. Agents: per request over x402. Clawback pays its specialists through escrow from its own wallet.
- **Double charge?** Every paid step is journaled before it is sent; uncertain writes are never retried blindly; each x402 payment spends one UTxO. A failed payment closes the Task as FAILED with no work delivered.
- **Who has paid you that isn't you?** Both Sokosumi Tasks were funded from our own workspace credits, and the only x402 sellers on preprod are ours. The loop is real and self-funded; the registry listing and event approval make it hireable by others.
- **Custody and privacy?** Users sign in their own wallet; the facilitator holds no keys. Uploaded rows are stored until the next upload today; per-user storage, deletion and redaction before model calls are on the roadmap. Preprod only.
- **What is simulated?** Demo merchants, the demo account's receipts, eSIM providers, simulated pledgers, scripted fleet runs when no model is configured. Each is labelled on screen.

## Sources

C+R Research 2022 (42%, $133); FTC, ICPEN and GPEN July 2024 (76% of 642); Chase subscription fatigue guidance; Apple Wallet iOS 27 recurring charges coverage; Sokosumi Task Schedules (masumi-network/sokosumi PR 5163); AWS AgentCore Browser session recording. Links in `README.md` and `docs/POSITIONING.md`.
