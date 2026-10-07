# Implementation notes (working doc)

What Overpaid does today, what the Cardano and Masumi team asked, and the two use cases we can show working with real accounts. Every outside fact links to its source; anything not checked is marked so.

## 1. What runs today

![Architecture](diagrams/architecture.svg)

Editable source: [`diagrams/architecture.excalidraw`](diagrams/architecture.excalidraw) (open it at excalidraw.com).

| Piece | Real or simulated | Where |
|---|---|---|
| Find on statements and receipts | Real parsers and detectors; the demo account's data is synthetic | `packages/find` |
| Fix (browser agents) | Real Claude tool loop and real browsers, but only against our four demo merchant sites | `services/fleet`, `services/merchants` |
| Specialist hire | Real x402 `masumi` payment, real escrow, result hash, verify, collect on preprod. The specialist is first party and files on a demo airline | `services/specialist`, `packages/cardano` |
| Bloc | Real pledges, refunds and settlement on preprod; providers are simulated | `services/bloc`, `contracts/bloc` |
| Sokosumi Coworker | Real Tasks, real paid Task, real escrow and result hash on preprod | `services/coworker`, `docs/COWORKER.md` |

## 2. The question we were asked

> For a Netflix-style subscription, how does the agent know it is unused, and how does it cancel it? Human in the loop, or does it have access?

The honest answer has two parts.

**Knowing "unused".** A card statement only shows that you pay; it can't show that nobody uses the thing. Today the Coworker flags "recurring charge with no usage evidence in the statement". That's a lead, not proof. Proof needs the vendor's own record of use: an admin API that reports activity per seat or per key. Consumer services like Netflix have no such API, so for them, usage stays a question the agent asks the human.

**Acting.** There are three levels. We pick per vendor and never go beyond what the user has granted.

1. **Draft:** the agent writes the cancellation or refund request and the human sends it. Works for everything, including Netflix.
2. **Prepare and approve:** the agent has a read-only token, prepares the exact change ("remove these 2 seats, saves $X a month"), and posts it to the Sokosumi Task. The human approves in the thread, and only then does the agent use a separate write token scoped to that one action. This is our default for B2B.
3. **Browser agent on the user's session:** our Fix fleet works through the merchant's own site and stops before the irreversible click for one-tap approval. Today it runs only on demo merchants. On real sites it would need the user's logged-in session, so we don't claim it for real merchants yet.

Blocking the next charge at the card level is possible only on cards you issue yourself. Stripe Issuing lets your code decline each authorization in real time ([Stripe docs](https://docs.stripe.com/issuing/controls/real-time-authorizations)). The networks' own stop-payment tools are sold to banks only ([Visa](https://developer.visa.com/capabilities/visa-stop-payment-service)). Plaid detects recurring charges but cannot cancel them ([Plaid](https://plaid.com/docs/api/products/transactions/)). Blocking a charge also doesn't end the contract, so it complements cancellation rather than replacing it.

## 3. Use case A: AI and API keys that keep budget but do nothing (demo today)

**Who pays:** engineering and finance leads at any team using LLM APIs. Teams create keys per project, hackathon or contractor, then forget them. Each forgotten key keeps a spending limit reserved, and if it leaks, it spends.

**Source of truth:** the OpenRouter management API ([docs](https://openrouter.ai/docs/features/provisioning-api-keys)):
- `GET /api/v1/keys` returns, per key: `name`, `created_at`, `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`, `limit`, `limit_remaining` and `disabled`.
- There's no last-used timestamp, so "unused" means zero `usage_monthly` (or zero since `created_at` for newer keys).
- The fix is `PATCH /api/v1/keys/{hash}` with `{"disabled": true}`, or `DELETE`.

The same pattern exists for:
- **OpenAI:** project API keys carry `last_used_at`, and an Admin API can delete them ([OpenAI](https://developers.openai.com/api/reference/resources/organization/subresources/projects/subresources/api_keys)).
- **Anthropic:** keys can be set `inactive` through the Admin API, which only organisations get ([Anthropic](https://platform.claude.com/docs/en/api/admin/api_keys/update)).

**Flow:**
1. A team member creates a Sokosumi Task such as "Audit our OpenRouter keys". The Coworker reads the management key from its own secret store (never from Task text).
2. It lists the keys. It flags those with zero usage this month that still hold a limit, plus any active key whose usage spikes against its own weekly average.
3. It posts a proposal on the Task: which keys, how much limit each holds, and what it will do.
4. The human approves in the Task thread with "approve". The agent disables those keys, then lists them again to show `disabled: true`, and completes the Task with a before and after table.
5. The Task is paid like any other: signed terms, escrow, result hash on chain, collection.

**What we claim:** the Coworker stops future waste and leak risk, and frees reserved budget. It is not a cash refund. On a real team, the dollar figure is the unused limit plus the monthly spend of keys nobody owns.

**What you need to do:** create an OpenRouter **management key** (Settings, Management API Keys) and put it in `.env` as `OPENROUTER_MANAGEMENT_KEY`. Create two throwaway keys with small limits and leave them unused, so the demo has something real to find. Your current key keeps working.

## 4. Use case B: paid seats nobody uses

**Source of truth, with a real "last active" date:**
- **GitHub Copilot Business:** `GET /orgs/{org}/copilot/billing/seats` returns `last_activity_at` per seat. `DELETE /orgs/{org}/copilot/billing/selected_users` cancels seats at the end of the billing cycle ([GitHub](https://docs.github.com/en/rest/copilot/copilot-user-management)). Activity only appears if the user's IDE sends telemetry, so the agent treats "never active" as a question for a human, not a verdict.
- **Google Workspace:** the Reports API returns each user's `accounts:last_login_time` ([Google](https://developers.google.com/workspace/admin/reports/v1/guides/manage-usage-users)). The License Manager API removes a license ([Google](https://developers.google.com/workspace/admin/licensing/reference/rest/v1/licenseAssignments/delete)).

**Flow:** the same as use case A, with a read token to list seats and their last activity, a proposal priced at seat cost times idle seats, human approval, then removal with a write token.

**Why it's B, not A:** it needs a paid Copilot org or a Workspace domain with a super-admin to grant consent. If we can't set one up today, the doc and code path still stand, and the demo uses A.

The cheapest real cash saving is an idle AWS Elastic IP. AWS charges $0.005 an hour for each public IPv4 address ([AWS](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights)), and the agent can find and release unattached ones. It needs an AWS account, which we don't have set up.

## 5. Why x402, and where it doesn't belong

We use x402 where one agent pays another, or pays for a resource, without an account or a stored secret.

- **The Coworker gets paid** through Masumi escrow (signed terms, result hash, collection). That's Masumi's payment flow, not a vendor API key.
- **Our app hires the specialist agent** over x402 `masumi`. Funds sit in escrow, with a refund if no result arrives and a dispute if the evidence doesn't check out. The point is that a stranger agent can be paid safely per job.
- **Per-call data the Coworker might buy:** for example, a web search when it needs a vendor's current cancellation terms or a price benchmark for "bill above market". Exa sells search over x402 at $0.004 to $0.015 per call with no account ([Exa](https://exa.ai/docs/reference/x402-guide)). Paying per call out of the Task's own budget beats keeping a long-lived API key for occasional lookups.

**Cardano caveat:** the Cardano preprod facilitator exists ([developers.cardano.org/x402](https://developers.cardano.org/x402)), but we found no third-party x402 seller on Cardano preprod. Exa and the Bazaar listings run on Base and Solana ([x402 Bazaar](https://docs.x402.org/extensions/bazaar)). Any Cardano x402 seller in our demo is one we run, and it's labelled first party.

**Where we don't use x402:** calling the customer's own vendor APIs (OpenRouter, GitHub, Google). Those need the customer's credentials, not payment. Adding x402 there would be decoration.

## 6. Trust rules the Coworker follows

- Read-only tokens to find; a separate, narrower write token to act, only after approval in the Task thread.
- Tokens live in the worker's secret store, never in Task text, results or logs.
- Every write is journaled before it happens; an uncertain write is never retried automatically.
- No paid work before escrow is confirmed on chain; a payment that can't be confirmed closes the Task as FAILED with the reason.
- Results say what the agent actually verified and what is only a lead.

## 7. Plan for today

1. Use case A in the Coworker: detect a key-audit Task, list keys, post the proposal, wait for "approve", disable, verify, complete. About 2 hours.
2. Run it as a paid Task in Personal Workspace, then in the event workspace once approved.
3. Keep the statement audit as the general entry point, with its wording tightened to "lead" where it has no usage source.
4. Slides and demo: the dashboard, the Coworker's key audit with a human approval, then the collection transaction.
