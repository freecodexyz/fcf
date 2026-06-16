#!/usr/bin/env bash
set -euo pipefail

SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
VERIFY="${VERIFY:-true}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  printf 'Missing PRIVATE_KEY.\n' >&2
  exit 1
fi

ARGS=(
  script/Deploy.s.sol
  --rpc-url "$SEPOLIA_RPC_URL"
  --broadcast
  --force
)

if [[ "$VERIFY" == "true" ]]; then
  ARGS+=(--verify)
fi

forge script "${ARGS[@]}"
