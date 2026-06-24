#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

E2E_LOCAL="false"
E2E_TESTNET="false"
FUND="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --e2e-local)
      E2E_LOCAL="true"
      shift
      ;;
    --e2e-testnet)
      E2E_TESTNET="true"
      shift
      ;;
    --fund)
      FUND="true"
      shift
      ;;
    -h|--help)
      usage_harness
      exit 0
      ;;
    *)
      echo "error: unknown argument '$1'"
      usage_harness
      exit 1
      ;;
  esac
done

require_stellar_cli
ensure_rust_toolchain

echo "==> Running Soroban unit tests"
(
  cd "$CONTRACTS_ROOT"
  cargo test
)

echo "==> Building contract wasm"
build_contract

WASM_FILE="$(wasm_path)"
if [[ ! -f "$WASM_FILE" ]]; then
  echo "error: expected wasm artifact at $WASM_FILE"
  exit 1
fi

echo "==> Local validation passed (unit tests + wasm build)"

if [[ "$E2E_LOCAL" == "true" ]]; then
  configure_network "local"
  if rpc_is_reachable "$STELLAR_RPC_URL"; then
    DEPLOY_ARGS=(--network local --source "$DEFAULT_SOURCE_ACCOUNT")
    if [[ "$FUND" == "true" ]]; then
      DEPLOY_ARGS+=(--fund)
    fi
    "$SCRIPT_DIR/deploy.sh" "${DEPLOY_ARGS[@]}"
  else
    echo "warning: local RPC not reachable at $STELLAR_RPC_URL; skipping e2e local deploy"
    echo "hint: start local network with:"
    echo "  docker run --rm -d -p 8000:8000 --name stellar stellar/quickstart:latest --local --enable-soroban-rpc"
  fi
fi

if [[ "$E2E_TESTNET" == "true" ]]; then
  DEPLOY_ARGS=(--network testnet --source "$DEFAULT_SOURCE_ACCOUNT")
  if [[ "$FUND" == "true" ]]; then
    DEPLOY_ARGS+=(--fund)
  fi
  "$SCRIPT_DIR/deploy.sh" "${DEPLOY_ARGS[@]}"
fi

echo "==> Test harness complete"
