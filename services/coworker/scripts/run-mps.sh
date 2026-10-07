#!/bin/zsh
# Keeps the local Masumi payment service up: it exits on some network errors, so restart it.
source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null
cd "${MPS_DIR:-$HOME/masumi-payment-service}" || exit 1
while true; do
  env -u COLLECTION_WALLET_V2_PREPROD_ADDRESS pnpm run dev
  echo "payment service exited ($?), restarting in 5s"
  sleep 5
done
