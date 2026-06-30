#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_ROOT="$PROJECT_ROOT/contracts"

CONTRACT_PACKAGE="escrow"
CONTRACT_ALIAS="escrow"
DEFAULT_SOURCE_ACCOUNT="afropay_escrow_deployer"

NETWORK="testnet"
SOURCE_ACCOUNT="$DEFAULT_SOURCE_ACCOUNT"
FUND="false"
SKIP_BUILD="false"

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

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-contract.sh [options]

Compile and deploy the escrow Soroban contract to Stellar testnet or local network.

Options:
  --network <local|testnet>   Target network (default: testnet)
  --source <account>          Source/signing account alias (default: afropay_escrow_deployer)
  --fund                      Fund the source account via friendbot (testnet/local)
  --skip-build                Skip wasm build step
  -h, --help                  Show this help message

Examples:
  # Deploy to testnet with auto-funding
  ./scripts/deploy-contract.sh --network testnet --fund

  # Deploy to local network
  ./scripts/deploy-contract.sh --network local --fund

  # Deploy without rebuilding
  ./scripts/deploy-contract.sh --skip-build
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
    cd "$CONTRACTS_ROOT/contracts/$CONTRACT_PACKAGE"
    stellar contract build
  )
}

wasm_path() {
  echo "$CONTRACTS_ROOT/contracts/$CONTRACT_PACKAGE/target/wasm32v1-none/release/${CONTRACT_PACKAGE}.wasm"
}

save_deployment_record() {
  local network="$1"
  local source_account="$2"
  local contract_id="$3"

  mkdir -p "$PROJECT_ROOT/deployments"
  local output_file="$PROJECT_ROOT/deployments/escrow-${network}.json"
  local deployed_at
  deployed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cat >"$output_file" <<EOF
{
  "network": "$network",
  "contract_id": "$contract_id",
  "contract_alias": "$CONTRACT_ALIAS",
  "contract_package": "$CONTRACT_PACKAGE",
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

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      NETWORK="$2"
      shift 2
      ;;
    --source)
      SOURCE_ACCOUNT="$2"
      shift 2
      ;;
    --fund)
      FUND="true"
      shift
      ;;
    --skip-build)
      SKIP_BUILD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument '$1'"
      usage
      exit 1
      ;;
  esac
done

# Main execution
require_stellar_cli
configure_network "$NETWORK"
ensure_source_account "$SOURCE_ACCOUNT" "$NETWORK" "$FUND"

if [[ "$SKIP_BUILD" != "true" ]]; then
  build_contract
fi

WASM_FILE="$(wasm_path)"
if [[ ! -f "$WASM_FILE" ]]; then
  echo "error: wasm artifact not found at $WASM_FILE"
  exit 1
fi

echo "==> Deploying $CONTRACT_PACKAGE to $NETWORK"
CONTRACT_ID="$(
  stellar contract deploy \
    --wasm "$WASM_FILE" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK" \
    --alias "$CONTRACT_ALIAS"
)"

echo "==> Deployed contract id: $CONTRACT_ID"
save_deployment_record "$NETWORK" "$SOURCE_ACCOUNT" "$CONTRACT_ID"
validate_deployed_contract "$NETWORK" "$SOURCE_ACCOUNT" "$CONTRACT_ID"

echo "==> Deployment complete"
echo "Contract ID: $CONTRACT_ID"
echo "Network: $NETWORK"
