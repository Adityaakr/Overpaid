#!/bin/zsh
# Keeps the local Masumi payment service up. It throws an uncaught error when a Blockfrost retry times out,
# so run it without watch mode (a crash must end the process) and restart it here.
source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null
cd "${MPS_DIR:-$HOME/masumi-payment-service}" || exit 1
while true; do
  env -u COLLECTION_WALLET_V2_PREPROD_ADDRESS npx tsx ./src/index.ts
  echo "payment service exited ($?), restarting in 5s"
  sleep 5
done
