#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

NETWORK="testnet"
SOURCE_ACCOUNT="$DEFAULT_SOURCE_ACCOUNT"
FUND="false"
SKIP_BUILD="false"
UPGRADE="false"
CONTRACT_ID=""
PAYMENT_ID=""

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
    --upgrade)
      UPGRADE="true"
      shift
      ;;
    --contract-id)
      CONTRACT_ID="$2"
      shift 2
      ;;
    --payment-id)
      PAYMENT_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage_deploy
      exit 0
      ;;
    *)
      echo "error: unknown argument '$1'"
      usage_deploy
      exit 1
      ;;
  esac
done

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

if [[ "$UPGRADE" == "true" ]]; then
  if [[ -z "$CONTRACT_ID" || -z "$PAYMENT_ID" ]]; then
    echo "error: --upgrade requires --contract-id and --payment-id"
    exit 1
  fi

  echo "==> Installing upgrade wasm"
  WASM_HASH="$(stellar contract install \
    --wasm "$WASM_FILE" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK")"
  echo "==> Upgrading $CONTRACT_ID"
  stellar contract upgrade \
    --id "$CONTRACT_ID" \
    --wasm-hash "$WASM_HASH" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK"
  echo "==> Migrating payment $PAYMENT_ID"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK" \
    -- \
    migrate \
    --admin "$SOURCE_ACCOUNT" \
    --payment-ids "[\"$PAYMENT_ID\"]"
else
  echo "==> Deploying $CONTRACT_PACKAGE to $NETWORK"
  CONTRACT_ID="$(
    stellar contract deploy \
      --wasm "$WASM_FILE" \
      --source-account "$SOURCE_ACCOUNT" \
      --network "$NETWORK" \
      --alias "$CONTRACT_ALIAS"
  )"
  stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$NETWORK" \
    -- \
    initialize \
    --admin "$SOURCE_ACCOUNT"
fi

echo "==> Deployed contract id: $CONTRACT_ID"
save_deployment_record "$NETWORK" "$SOURCE_ACCOUNT" "$CONTRACT_ID"
validate_deployed_contract "$NETWORK" "$SOURCE_ACCOUNT" "$CONTRACT_ID"

echo "==> Deployment complete"
