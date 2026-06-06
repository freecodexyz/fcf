#!/usr/bin/env bash
set -euo pipefail

HOST="127.0.0.1"
PORT="8545"
RPC_URL="http://${HOST}:${PORT}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if [[ -f "$SCRIPT_DIR/foundry.toml" ]]; then
  FOUNDRY_ROOT="$SCRIPT_DIR"
elif [[ -f "$SCRIPT_DIR/contracts/foundry.toml" ]]; then
  FOUNDRY_ROOT="$SCRIPT_DIR/contracts"
else
  FOUNDRY_ROOT="$PWD"
fi

usage() {
  printf 'Usage: %s <contract_path_identifier>\n' "${0##*/}" >&2
  printf 'Example: %s src/Contract.sol:Contract\n' "${0##*/}" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]] && kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi

  if [[ -n "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

CONTRACT_PATH_IDENTIFIER="$1"

if [[ "$CONTRACT_PATH_IDENTIFIER" != *:* ]]; then
  printf 'contract_path_identifier must look like: src/Contract.sol:Contract\n' >&2
  exit 1
fi

require_command anvil
require_command cast
require_command forge

TMP_DIR="$(mktemp -d)"
ANVIL_LOG="$TMP_DIR/anvil.log"
ANVIL_PID=""
trap cleanup EXIT

anvil \
  --host "$HOST" \
  --port "$PORT" \
  --accounts 1 \
  --mnemonic-random \
  >"$ANVIL_LOG" 2>&1 &
ANVIL_PID="$!"

for _ in {1..50}; do
  if ! kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    printf 'Anvil failed to start. Output:\n' >&2
    cat "$ANVIL_LOG" >&2
    exit 1
  fi

  if cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi

  sleep 0.2
done

if ! cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  printf 'Timed out waiting for Anvil at %s. Output:\n' "$RPC_URL" >&2
  cat "$ANVIL_LOG" >&2
  exit 1
fi

PRIVATE_KEY=""
for _ in {1..50}; do
  PRIVATE_KEY="$(awk '/Private Keys/{in_private_keys=1; next} in_private_keys && $1 ~ /^\([0-9]+\)$/ && $2 ~ /^0x/ {print $2; exit}' "$ANVIL_LOG")"

  if [[ -n "$PRIVATE_KEY" ]]; then
    break
  fi

  sleep 0.1
done

if [[ -z "$PRIVATE_KEY" ]]; then
  printf 'Could not read generated Anvil private key. Output:\n' >&2
  cat "$ANVIL_LOG" >&2
  exit 1
fi

OWNER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"

printf 'RPC URL: %s\n' "$RPC_URL"
printf 'Foundry root: %s\n' "$FOUNDRY_ROOT"
printf 'Deployer private key: %s\n' "$PRIVATE_KEY"
printf 'Owner address: %s\n' "$OWNER_ADDRESS"

if ! DEPLOY_OUTPUT="$(forge create \
  --root "$FOUNDRY_ROOT" \
  --broadcast \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  "$CONTRACT_PATH_IDENTIFIER" \
  --constructor-args "$OWNER_ADDRESS" 2>&1)"; then
  printf '%s\n' "$DEPLOY_OUTPUT" >&2
  exit 1
fi

CONTRACT_ADDRESS="$(printf '%s\n' "$DEPLOY_OUTPUT" | awk '/Deployed to:/ {print $3; exit} /Contract Address:/ {print $3; exit}')"

printf '%s\n' "$DEPLOY_OUTPUT"

if [[ -z "$CONTRACT_ADDRESS" ]]; then
  printf 'Could not parse deployed contract address from forge output.\n' >&2
  exit 1
fi

printf 'Created contract address: %s\n' "$CONTRACT_ADDRESS"
printf 'Anvil is running. Press Ctrl-C to stop it.\n'

wait "$ANVIL_PID"
