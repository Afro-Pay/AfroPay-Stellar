#!/usr/bin/env bash

set -euo pipefail

CONTRACTS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT_PACKAGE="payment_registry"
CONTRACT_ALIAS="payment_registry"
DEFAULT_SOURCE_ACCOUNT="afropay_deployer"

require_stellar_cli() {
  if ! command -v stellar >/dev/null 2>&1; then
    echo "error: stellar CLI is required. Install from https://developers.stellar.org/docs/tools/cli"
    exit 1
  fi
}

ensure_rust_toolchain() {
  if command -v rustup >/dev/null 2>&1; then
    rustup target add wasm32v1-none >/dev/null 2>&1 || true
    local rustup_bin
    rustup_bin="$(dirname "$(rustup which cargo 2>/dev/null || true)")"
    if [[ -n "$rustup_bin" && -d "$rustup_bin" ]]; then
      export PATH="$rustup_bin:$PATH"
    fi
  fi
}

usage_deploy() {
  cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

Compile and deploy the payment_registry Soroban contract.

Options:
  --network <local|testnet>   Target network (default: testnet)
  --source <account>          Source/signing account alias (default: afropay_deployer)
  --fund                      Fund the source account via friendbot (testnet/local)
  --skip-build                Skip wasm build step
  -h, --help                  Show this help message
EOF
}

usage_harness() {
  cat <<'EOF'
Usage: ./scripts/test-harness.sh [options]

Run local contract validation for the Soroban workspace.

Options:
  --e2e-local                 Deploy and validate against a local RPC if reachable
  --e2e-testnet               Deploy and validate against testnet (requires --fund or funded account)
  --fund                      Fund deployer account before e2e deployment
  -h, --help                  Show this help message
EOF
}

configure_network() {
  local network="$1"
  local rpc_url passphrase

  case "$network" in
    testnet)
      rpc_url="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
      passphrase="Test SDF Network ; September 2015"
      ;;
    local)
      rpc_url="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
      passphrase="Standalone Network ; February 2017"
      ;;
    *)
      echo "error: unsupported network '$network' (use local or testnet)"
      exit 1
      ;;
  esac

  stellar network add "$network" \
    --rpc-url "$rpc_url" \
    --network-passphrase "$passphrase" >/dev/null 2>&1 || true

  export STELLAR_NETWORK="$network"
  export STELLAR_RPC_URL="$rpc_url"
  export STELLAR_NETWORK_PASSPHRASE="$passphrase"
}

ensure_source_account() {
  local source_account="$1"
  local network="$2"
  local fund="$3"

  if ! stellar keys address "$source_account" >/dev/null 2>&1; then
    echo "==> Creating source account alias: $source_account"
    stellar keys generate "$source_account"
  fi

  if [[ "$fund" == "true" ]]; then
    echo "==> Funding $source_account on $network"
    stellar keys fund "$source_account" --network "$network"
  fi
}

build_contract() {
  ensure_rust_toolchain
  echo "==> Building $CONTRACT_PACKAGE wasm"
  (
    cd "$CONTRACTS_ROOT"
    stellar contract build --package "$CONTRACT_PACKAGE"
  )
}

wasm_path() {
  echo "$CONTRACTS_ROOT/target/wasm32v1-none/release/${CONTRACT_PACKAGE}.wasm"
}

save_deployment_record() {
  local network="$1"
  local source_account="$2"
  local contract_id="$3"

  mkdir -p "$CONTRACTS_ROOT/deployments"
  local output_file="$CONTRACTS_ROOT/deployments/${network}.json"
  local deployed_at
  deployed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cat >"$output_file" <<EOF
{
  "network": "$network",
  "contract_id": "$contract_id",
  "contract_alias": "$CONTRACT_ALIAS",
  "wasm_path": "$(wasm_path)",
  "source_account": "$source_account",
  "deployed_at": "$deployed_at"
}
EOF

  echo "==> Saved deployment record to $output_file"
}

validate_deployed_contract() {
  local network="$1"
  local source_account="$2"
  local contract_id="$3"

  echo "==> Validating deployed contract $contract_id"
  local version
  version="$(stellar contract invoke \
    --id "$contract_id" \
    --source-account "$source_account" \
    --network "$network" \
    -- \
    version)"

  if [[ "$version" != "1" ]]; then
    echo "error: unexpected contract version '$version'"
    exit 1
  fi

  echo "==> Contract version check passed (version=$version)"
}

rpc_is_reachable() {
  local rpc_url="$1"
  curl -sf "$rpc_url" >/dev/null 2>&1
}
