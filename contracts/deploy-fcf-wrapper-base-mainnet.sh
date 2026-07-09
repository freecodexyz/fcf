#!/usr/bin/env bash
set -euo pipefail

BASE_MAINNET_RPC_URL="${BASE_MAINNET_RPC_URL:-https://mainnet.base.org}"
VERIFY="${VERIFY:-true}"
CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_BIN="${FORGE_BIN:-base-forge}"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  printf 'Missing PRIVATE_KEY.\n' >&2
  exit 1
fi

if [[ -z "${TREASURY_ADDRESS:-}" ]]; then
  printf 'Missing TREASURY_ADDRESS.\n' >&2
  exit 1
fi

if ! command -v "$FORGE_BIN" >/dev/null 2>&1; then
  printf 'Missing %s.\n' "$FORGE_BIN" >&2
  printf 'Install Base Foundry with `curl -L https://raw.githubusercontent.com/base/base-anvil/HEAD/foundryup/install | bash && base-foundryup`, or set FORGE_BIN to a patched forge binary.\n' >&2
  exit 1
fi

ARGS=(
  "$CONTRACTS_DIR/script/DeployFCFWrapper.s.sol:DeployFCFWrapper"
  --root "$CONTRACTS_DIR"
  --rpc-url "$BASE_MAINNET_RPC_URL"
  --broadcast
)

if [[ "$VERIFY" == "true" ]]; then
  ARGS+=(--verify)
fi

"$FORGE_BIN" script "${ARGS[@]}"
