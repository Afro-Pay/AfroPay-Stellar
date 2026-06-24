#!/usr/bin/env bash
# =============================================================================
# AfroPay-Stellar — Environment Validation Script
# =============================================================================
# Validates that all required environment variables are set before starting
# a service. Run this in CI/CD pipelines and as part of container entrypoints.
#
# Usage:
#   source scripts/validate-env.sh        # sources .env then validates
#   scripts/validate-env.sh               # runs in subshell, checks .env
#
# To check a specific service's requirements:
#   SERVICE=api scripts/validate-env.sh
#   SERVICE=frontend scripts/validate-env.sh
#   SERVICE=rust-worker scripts/validate-env.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if it exists
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

SERVICE="${SERVICE:-all}"

echo "[AfroPay] Validating environment variables for service: $SERVICE"

HAS_ERRORS=0

check_var() {
  local var_name="$1"
  local hint="$2"
  if [ -z "${!var_name:-}" ]; then
    echo "  [MISSING] $var_name — $hint"
    HAS_ERRORS=1
  else
    local val="${!var_name}"
    # Mask the value for display (show first 4 chars)
    local masked="${val:0:4}..."
    echo "  [OK]      $var_name=$masked"
  fi
}

# ---- API requirements ----
if [ "$SERVICE" = "all" ] || [ "$SERVICE" = "api" ]; then
  echo ""
  echo "--- API ---"
  check_var "DATABASE_URL" "PostgreSQL connection string (postgresql://...)"
  check_var "REDIS_URL" "Redis connection string (redis://...)"
  check_var "JWT_SECRET" "JWT signing secret (min 32 chars)"
  check_var "ENCRYPTION_KEY" "AES-256 key (64 hex chars)"
  check_var "STELLAR_NETWORK" "Stellar network (testnet|mainnet)"
  check_var "STELLAR_HORIZON_URL" "Horizon API URL"
  check_var "ANCHOR_USDC_URL" "USDC anchor URL"
  check_var "ANCHOR_NGN_URL" "NGN anchor URL"
fi

# ---- Frontend requirements ----
if [ "$SERVICE" = "all" ] || [ "$SERVICE" = "frontend" ]; then
  echo ""
  echo "--- Frontend ---"
  check_var "NEXT_PUBLIC_API_URL" "API base URL"
fi

# ---- Rust Worker requirements ----
if [ "$SERVICE" = "all" ] || [ "$SERVICE" = "rust-worker" ]; then
  echo ""
  echo "--- Rust Worker ---"
  check_var "REDIS_URL" "Redis connection string (redis://...)"
  check_var "STELLAR_HORIZON_URL" "Horizon API URL"
fi

# ---- Python Analytics requirements ----
if [ "$SERVICE" = "all" ] || [ "$SERVICE" = "fraud-service" ]; then
  echo ""
  echo "--- Python Analytics ---"
  check_var "DATABASE_URL" "PostgreSQL connection string"
  check_var "REDIS_URL" "Redis connection string"
fi

echo ""
if [ "$HAS_ERRORS" -eq 1 ]; then
  echo "[AfroPay] ❌ Environment validation FAILED — missing required variables above."
  exit 1
else
  echo "[AfroPay] ✅ Environment validation passed."
fi
