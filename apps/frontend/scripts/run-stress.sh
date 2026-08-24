#!/usr/bin/env bash
#
# AfroPay-Stellar E2E + Stress Test Runner
# =========================================
#
# Orchestrates the full stack (Docker Compose) and runs the Playwright E2E
# and concurrency stress test suite.
#
# Usage:
#   ./scripts/run-stress.sh          # Full pipeline (default)
#   ./scripts/run-stress.sh --e2e    # E2E tests only (sequential)
#   ./scripts/run-stress.sh --stress # Stress test only (50 concurrent)
#   ./scripts/run-stress.sh --help   # Show this help
#
# Requirements:
#   - Docker & Docker Compose v2
#   - Node.js >= 18
#   - Playwright browsers installed (npx playwright install chromium)
#   - Ports 3000, 3001, 5432, 6379 free

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Config ──────────────────────────────────────────────────────────────────
STACK_NAME="afropay-stress"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
STRESS_CONCURRENCY="${STRESS_CONCURRENCY:-50}"
E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
E2E_API_URL="${E2E_API_URL:-http://127.0.0.1:3001}"

# ─── Help ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" ]]; then
  sed -n '/^#/p; /^$/q' "$0" | sed 's/^# //; s/^#$//'
  exit 0
fi

# ─── Colors ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; exit 1; }

# ─── Cleanup handler ─────────────────────────────────────────────────────────
cleanup() {
  info "Shutting down Docker Compose stack..."
  docker compose -p "$STACK_NAME" -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# ─── Phase 1: Start Docker Compose ──────────────────────────────────────────
phase1_start_stack() {
  info "Starting Docker Compose stack (postgres, redis, api, frontend, rust-worker, python-analytics)..."
  docker compose -p "$STACK_NAME" -f "$COMPOSE_FILE" up --build --wait --wait-timeout 120 -d 2>&1

  info "Waiting for API health endpoint..."
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if curl -sf "${E2E_API_URL}/health" > /dev/null 2>&1; then
      ok "API is healthy at ${E2E_API_URL}/health"
      return 0
    fi
    sleep 2
    retries=$((retries - 1))
  done
  fail "API did not become healthy within 60s"
}

# ─── Phase 2: Run Playwright E2E tests ──────────────────────────────────────
phase2_run_e2e() {
  info "Running Playwright E2E tests..."
  cd "$PROJECT_DIR"

  if ! npx playwright --version > /dev/null 2>&1; then
    warn "Playwright not found. Installing..."
    npm install --no-save @playwright/test > /dev/null 2>&1
    npx playwright install chromium > /dev/null 2>&1
  fi

  E2E_BASE_URL="$E2E_BASE_URL" E2E_API_URL="$E2E_API_URL" \
    npx playwright test --config=playwright.config.ts --project=remittance-flow 2>&1

  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    ok "All E2E tests passed."
  else
    warn "Some E2E tests failed (exit code $exit_code)."
  fi
  return $exit_code
}

# ─── Phase 3: Run Concurrency Stress Test ───────────────────────────────────
phase3_run_stress() {
  info "Running concurrency stress test (${STRESS_CONCURRENCY} concurrent users)..."
  cd "$PROJECT_DIR"

  E2E_BASE_URL="$E2E_BASE_URL" \
  E2E_API_URL="$E2E_API_URL" \
  STRESS_CONCURRENCY="$STRESS_CONCURRENCY" \
  node scripts/stress-test.mjs 2>&1

  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    ok "Stress test completed successfully."
  else
    warn "Stress test script exited with code $exit_code."
  fi
  return $exit_code
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  local mode="${1:-full}"
  local overall_exit=0

  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  AfroPay-Stellar E2E & Stress Test Runner        ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""

  # Check prerequisites
  command -v docker > /dev/null 2>&1 || fail "Docker is not installed."
  command -v node > /dev/null 2>&1 || fail "Node.js is not installed."

  # Phase 1: Start stack (unless --stress-only, which expects stack already running)
  if [[ "$mode" != "stress-only" ]]; then
    phase1_start_stack
  fi

  # Phase 2: E2E
  if [[ "$mode" == "e2e" || "$mode" == "full" ]]; then
    phase2_run_e2e || overall_exit=1
  fi

  # Phase 3: Stress
  if [[ "$mode" == "stress" || "$mode" == "full" || "$mode" == "stress-only" ]]; then
    phase3_run_stress || overall_exit=1
  fi

  echo ""
  if [[ $overall_exit -eq 0 ]]; then
    ok "All tests passed. 🎉"
  else
    warn "Some tests failed. Check the HTML report for details."
  fi
  echo ""

  exit $overall_exit
}

main "$@"