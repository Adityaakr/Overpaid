# Vendored Masumi contracts

`payment-v2.plutus.json` (vested_pay v2) and `registry-v2.plutus.json` (registry V2 mint policy) are copied
unmodified from `masumi-network/masumi-payment-service` at commit `71455701ac22c3380c50da54089e1b7363f6825d`
(`smart-contracts/payment-v2/plutus.json`, `smart-contracts/registry-v2/plutus.json`), Aiken v1.1.23.
MIT License, Copyright (c) 2024 NMKR. See `LICENSE-masumi`.

Never recompile: the escrow address depends on these exact bytes. `src/escrow/script.ts` asserts at load time that
the applied script hash equals `@x402/cardano`'s `masumiEscrowScriptHash(MASUMI_DEFAULT_DEPLOYMENT)`.
