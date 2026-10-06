# Decisions

Each entry: what, why, and what would change it.

## D1. Product name is Overpaid (6 Oct 2026)
The human renamed Ombud to Overpaid. User-facing text says Overpaid; the repository directory stays `ombud`. Package scope is `@overpaid/*`. The brief still says Ombud; read it as Overpaid.

## D2. Postgres runs natively, not in Docker (6 Oct 2026)
The build machine has no Docker. Homebrew Postgres 17 is running locally, database `overpaid`. `infra/docker-compose.yml` is still provided for a clean machine. Change if: a teammate's machine has Docker only.

## D3. x402 facilitator: in-process TypeScript first, hosted CF as second (6 Oct 2026)
No Java on the build machine, and the Java facilitator's README says the current build hasn't been re-proven live. `@x402/cardano@2.26.0` exports a full facilitator (`ExactCardanoScheme` from `/exact/facilitator`), so the specialist runs it in-process with only a Blockfrost key. The CF hosted preprod facilitator (`/supported` advertises default, masumi and script, `l1Confirmations` 0 to 20) is the fallback by changing one URL. Sources: `docs/research/x402-facilitator.md`, `docs/research/x402-masumi.md`.

## D4. Shared demo world (6 Oct 2026)
`packages/shared/src/demo-world.ts` is the single source of truth for the demo user's accounts, orders, the delayed flight and the eSIM bill. The demo merchants seed from it and the synthetic receipts are generated from it, so Find and Fix agree by construction.

## D5. Find pipeline lives in `packages/find` (6 Oct 2026)
The brief puts ingest in `services/api`. The pipeline is pure functions with fixtures, so it lives in a package the API imports; the API owns persistence and events.

## D6. TypeScript 5.9 (6 Oct 2026)
npm `latest` is TypeScript 7 (native). The web app and tooling are on 5.9; stay there for the hackathon.

## D7. Product app lives in the same Next.js app as the landing page (6 Oct 2026)
The landing page at `/` is the Makro-template copy; the product lives under `/app/*` in the same Next.js app, reusing its tokens (Inter, the lime accent, the light and dark surfaces) so the site and product feel like one thing.

## D8. Numbers use Inter with tabular figures, not JetBrains Mono (6 Oct 2026)
The brief asks for a monospace face for numbers. The product copies the landing page's design (the human's instruction for the whole site), whose dashboards set numbers in Inter Display. Every number uses tabular figures so columns align; the evidence hashes use a system monospace.

## D9. Bloc contract is one multi-handler validator (6 Oct 2026)
A pledge validator parameterised by the settle validator's hash, and a settle validator that needs the pledge hash, cannot both be compiled. Spend, withdraw and publish handlers share one validator and one hash (the design-patterns `multi-utxo-indexer` example does this). Source: `docs/research/aiken-bloc.md`.

## D10. Disputes on the default Masumi deployment need the specialist's cooperation (6 Oct 2026)
On Masumi's preprod `vested_pay` v2 deployment, a disputed escrow leaves only through seller `AuthorizeRefund`, buyer `AuthorizeWithdrawal`, or Masumi's 2-of-3 admin keys after `externalDisputeUnlockTime`. We hold no admin key. Refund path (b) therefore uses the specialist's `AuthorizeRefund`, and the UI says disputes otherwise go to Masumi's admins. Source: `docs/research/vested-pay-v2.md`.

## D11. The specialist is unregistered until a fixed public hostname exists (6 Oct 2026)
Registration on the Masumi registry needs a stable public HTTPS URL answering `/availability`. An unregistered seller skips every registry check and the x402 masumi lock still works. Register as soon as the tunnel hostname arrives. Source: `docs/research/x402-masumi.md`.
