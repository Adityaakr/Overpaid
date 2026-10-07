# Pitch (three minutes, recorded)

One story: money you are already losing, recovered by agents. A real statement goes in once; the agents work; you get a Sunday review; one agent is hired and paid through escrow on Cardano. The recording goes inside the slides; no live demo. Record twice, keep the cleaner take. Every number is real; the (demo) account appears only where a browser agent is shown, and is labelled.

## Shot list (2 min 40 s)

Record the screen at 1920x1080 in Chrome with Lace on Preprod, nothing else open. Record the voice separately and cut to it. Run one research agent on Netflix before recording so the "what the agent saw" page is ready; start a second one on Spotify live so the fleet tile is moving on camera.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 | Landing page, hero "Money you're owed, clawed back." | "Forgotten subscriptions, duplicate charges, price rises, bank fees. Everyone has them. Nobody chases them, because no single one is worth twenty minutes. Clawback does." |
| 0:12 | `/audit`, drop `sample-statement.csv`, the audit appears | "A real bank export goes in once. Every charge is priced per year, duplicates and fees are caught, and every item carries its rows and a drafted message. Free." |
| 0:30 | Click "Start my autopilot", the Sunday review opens | "Then you put it on autopilot. This is the only page you open: once a week. Keep or remove, one tap each." |
| 0:45 | Click "Send an agent" on Spotify, switch to Agents: the tile is live, Netflix shows "Checked" | "For each line a browser agent goes to the merchant's own site. Read-only: it never logs in or submits. It brings back the cancel page, the prices, and the support route." |
| 1:05 | Open "What the agent saw" on Netflix: steps, URLs, screenshots, hashes | "Every step is a hashed screenshot, so you see exactly what it did." |
| 1:20 | Back on the review: "Sign and anchor", Lace popup, sign, Cardanoscan link | "You sign one transaction from your own wallet that puts the hash of this review on Cardano. Nothing custodial. Only the network fee." |
| 1:40 | Demo account, fleet tile pausing on "Confirm cancellation", approve (label: demo merchant) | "When an agent reaches something irreversible, it stops and asks you." |
| 1:55 | Specialist hire: escrow lock, result hash, collection on Cardanoscan | "Some claims need an expert. Clawback hires a specialist agent and pays it into Masumi escrow from its own wallet. The fee releases only when the result is on chain and verified. You never pay an agent." |
| 2:15 | Sokosumi Task thread, then the three hashes (b301bedf, f0590c79, 9f54e593) | "For companies, the same engine is a Coworker on Sokosumi. A real bank export, audited, one test USDM paid per Task into escrow and collected, inside the TOKEN2049 workspace." |
| 2:30 | Slide: pricing and roadmap in one line | "Nothing upfront. A fee only on money confirmed back. Next: bank connections and specialists we did not build. Clawback works for you while you are not looking." |

## Do not show

Group bargaining, the Aiken contract, the (demo) $1,086 ledger total, the agent-facing x402 endpoint beyond one line, OpenRouter or Copilot specifics, the Adobe run (blocked site). Each adds a noun; none adds to the one story.

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
