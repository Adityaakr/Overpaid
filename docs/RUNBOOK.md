# Runbook

## Before the slot

| When | Step | Command or place |
|---|---|---|
| T-24 h | Faucet request #2 to the treasury | https://docs.cardano.org/cardano-testnets/tools/faucet, address from `npx tsx scripts/wallets.ts` |
| T-2 h | Wallets funded: buyer and seller about 20 tADA each, bloc admin about 30, providers about 5, treasury the rest | `npx tsx scripts/wallets.ts` |
| T-90 min | Stack up | `pnpm dev`, then `/app/control`: every service green |
| T-90 min | Tunnel up (specialist, providers, `/join` only) | `cloudflared tunnel run <name>` |
| **T-70 min** | **Start the long-timer hire** so its collection lands on stage | `/app/control`, "Start long-timer hire" (or `POST /api/hires {"longTimer":true}`) |
| T-30 min | Fresh bloc campaign, join tokens minted, QR visible | `/app/control`, "Open a fresh bloc campaign" |
| T-10 min | Reset the demo (keeps hires) | `pnpm demo:reset` |
| T-10 min | Pre-warm browsers (AgentCore) | first Fix run warms sessions; or run `check-fix` with `RUNS=1` |
| T-5 min | Check the projector's reduced-motion setting (NumberFlow respects it) | System settings |

Escrow timing: the x402 masumi defaults put `submitResultTime` 15 min, `unlockTime` 35 min and `externalDisputeUnlockTime` 55 min after `payByTime` (pay-by is quote time plus 5 min). Collection is possible from about 40 minutes after the lock; starting the long-timer at T-70 leaves headroom.

## On stage (three minutes)

1. `/app` "Use demo data": the total appears with reasons. (Act 1)
2. "Approve and fix 8": `/app/fleet`, eight tiles; tap Approve on each card. The counter climbs. (Act 2)
3. `/app/specialist`: "Hire for the Skylane claim" locks the fee live; the long-timer card shows its collection. (Cardano)
4. `/app/bloc`: phones join from the QR; "Settle the bloc" from control; the settlement transaction and `N_max` appear. (Act 3)

## Reset

`pnpm demo:reset` clears ledger, tasks, approvals, evidence rows and receipts and resets every merchant in under a second. It keeps specialist hires.

## Fallbacks

| Problem (timebox) | Switch to | How |
|---|---|---|
| Bedrock blocked (30 min) | Anthropic API | set `ANTHROPIC_API_KEY`, restart the fleet |
| No model at all | Scripted mode | automatic; tiles say "scripted" |
| AgentCore region or quota (30 min) | Local Chromium | `FLEET_PROVIDER=local`, restart the fleet |
| Eight live tiles too heavy | Lower resolution or fewer tiles | fleet `SCREENCAST_*` knobs in `.env` |
| x402 masumi lock blocked (45 min) | Masumi payment service purchase API | brief, Specialist hire step 8 |
| Hosted facilitator down | In-process facilitator in the specialist | default; `X402_FACILITATOR_URL` only for the bloc |
| No fixed public hostname | Specialist unregistered (still works over x402) | DECISIONS D11 |
| Script-method pledges rejected (45 min) | Direct submit with the same offer format | bloc service records it |
| Not enough test USDM | tADA pledges capped at 3 tADA, labelled | default |
