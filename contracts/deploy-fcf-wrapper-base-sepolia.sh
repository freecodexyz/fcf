#!/usr/bin/env bash
set -euo pipefail

BASE_SEPOLIA_RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
VERIFY="${VERIFY:-true}"
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  printf 'Missing PRIVATE_KEY.\n' >&2
  exit 1
fi

if [[ -z "${TREASURY_ADDRESS:-}" ]]; then
  printf 'Missing TREASURY_ADDRESS.\n' >&2
  exit 1
fi

ARGS=(
  "$CONTRACTS_DIR/script/DeployFCFWrapper.s.sol:DeployFCFWrapper"
  --root "$CONTRACTS_DIR"
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
  --broadcast
)

if [[ "$VERIFY" == "true" ]]; then
  ARGS+=(--verify)
fi

forge script "${ARGS[@]}"
