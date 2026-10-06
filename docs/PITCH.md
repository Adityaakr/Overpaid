# Pitch (three minutes)

Numbers marked (demo) come from the synthetic demo account and are shown as demo data on screen. Fill the bracketed ones from the live run.

## Script

**0:00 Opening.** "Businesses earn a spread on your inattention. Forty-two percent of people forgot they were still paying for a subscription, and they underestimate what they pay by $133 a month. No single item is worth twenty minutes of your time. For an agent, every item is."

**0:20 Find.** Drop in receipts and a statement. "Overpaid read 223 receipts and 306 card transactions in under a second and found $1,086.90 (demo). Every line says why, and where it came from."

**0:45 Fix.** "Approve and fix." Eight browsers start, each on a merchant's own website. "Merchants make this hard on purpose: 76% of 642 subscription sites use at least one dark pattern. The agents go through the pause screen, the retention offer and the survey, and stop before anything irreversible. I approve with one tap." Counter climbs. "Every recovery is confirmed on the merchant's own status page, with an evidence hash."

**1:30 Specialist on Cardano.** "One claim needs expertise: a four-hour flight delay the airline's form rejects unless you know the right category. Overpaid hires a specialist agent and pays it over x402 into Masumi's escrow on Cardano." Lock lands live. "The specialist files the claim, waits until the airline shows Compensation paid, and commits the evidence hash on chain. Overpaid re-checks it; the fee releases at unlock time unless we dispute, and we dispute automatically if the evidence doesn't match. Here is a hire from an hour ago, collected [tx]."

**2:15 Bargain.** "Some bills are just too high. Scan the QR." Phones pledge on chain. "Providers see real demand and bid. One transaction pays the winner and refunds every member the difference: [N] pledges, atomic." "Pledges sit in a script we hold no key to; anyone can refund them after the deadline."

**2:45 Close.** "Muse works for Meta. Overpaid works for you. It takes a fee only on money that comes back, paid from your own wallet after the recovery is confirmed, doesn't train on your data, and its agents announce themselves."

## Judge Q&A

- **Does the fee release only when money is back?** No. It releases after `unlockTime` unless Overpaid disputes first; Overpaid's verifier checks the airline status page and the evidence hash before staying silent. Disputes then go to the specialist or Masumi's admin multisig after `externalDisputeUnlockTime`. There is no protocol fee in the v2 validator.
- **Is the specialist third party?** Not yet. It is first party, built by the Overpaid team and labelled so. Any Masumi-registered specialist can be hired the same way.
- **Custody?** Users' bloc funds sit in a script Overpaid holds no key to, and anyone can build the refund after the deadline. The demo room wallets are custodial and labelled. Preprod only; licensing review (MAS PSA, FinCEN) before mainnet.
- **Bloc capacity?** Measured memory cost puts one atomic settlement at about 40 pledges (71% of the memory budget). Larger blocs settle in several transactions, each atomic, not jointly atomic, and the screen says so.
- **Is this legal for agents?** Overpaid works only on the user's own accounts, identifies itself as an agent on every request, and never presents itself as legal advice. Amazon v. Perplexity (Ninth Circuit, August 2026) is relevant to agents as user tools.
- **What's simulated?** Demo merchants, the demo account's receipts, eSIM providers, simulated pledgers, and scripted fleet runs when no model is configured. Each is labelled on screen.

## Sources

C+R Research 2022 (42%, $133); FTC, ICPEN and GPEN July 2024 (76% of 642); Bankrate 2024 ($244 unused gift cards); Zscaler ThreatLabz July 2026 (4 of 26 models paid after hidden instructions); FTC DoNotPay order 2025. Full links in `docs/BRIEF.md` resources.
