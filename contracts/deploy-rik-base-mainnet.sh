#!/usr/bin/env bash
set -euo pipefail

BASE_MAINNET_RPC_URL="${BASE_MAINNET_RPC_URL:-https://mainnet.base.org}"
VERIFY="${VERIFY:-true}"
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  printf 'Missing PRIVATE_KEY.\n' >&2
  exit 1
fi

ARGS=(
  "$CONTRACTS_DIR/script/DeployRIK.s.sol:DeployRIK"
  --root "$CONTRACTS_DIR"
  --rpc-url "$BASE_MAINNET_RPC_URL"
  --broadcast
)

if [[ "$VERIFY" == "true" ]]; then
  ARGS+=(--verify)
fi

forge script "${ARGS[@]}"
