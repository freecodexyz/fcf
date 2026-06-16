#!/usr/bin/env bash
set -euo pipefail

BASE_SEPOLIA_RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
VERIFY="${VERIFY:-true}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  printf 'Missing PRIVATE_KEY.\n' >&2
  exit 1
fi

if [[ -z "${AIRLOCK_ADDRESS:-}" ]]; then
  printf 'Missing AIRLOCK_ADDRESS.\n' >&2
  exit 1
fi

if [[ -z "${RIK_ADDRESS:-}" ]]; then
  printf 'Missing RIK_ADDRESS.\n' >&2
  exit 1
fi

ARGS=(
  script/DeployRIKLauncher.s.sol
  --rpc-url "$BASE_SEPOLIA_RPC_URL"
  --broadcast
)

if [[ "$VERIFY" == "true" ]]; then
  ARGS+=(--verify)
fi

forge script "${ARGS[@]}"
