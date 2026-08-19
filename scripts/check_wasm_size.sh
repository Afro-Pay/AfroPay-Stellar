#!/usr/bin/env bash

set -euo pipefail

LIMIT_KB="${WASM_SIZE_LIMIT_KB:-500}"

LIMIT_BYTES=$(( LIMIT_KB * 1024 ))

WASM_DIR="contracts/target/wasm32v1-none/release"

FAILED=0

if [ ! -d "$WASM_DIR" ]; then
  echo "ERROR: WASM output directory not found: $WASM_DIR"
  exit 1
fi

WASM_FILES=$(find "$WASM_DIR" -maxdepth 1 -name "*.wasm" | sort)

if [ -z "$WASM_FILES" ]; then
  echo "ERROR: No .wasm files found in $WASM_DIR"
  exit 1
fi

echo "WASM size budget: ${LIMIT_KB}KB per contract"
echo "---"

for wasm in $WASM_FILES; do
  size=$(wc -c < "$wasm")
  size_kb=$(( size / 1024 ))
  name=$(basename "$wasm")

  if [ "$size" -gt "$LIMIT_BYTES" ]; then
    echo "FAIL  $name — ${size_kb}KB (limit: ${LIMIT_KB}KB, over by $(( size_kb - LIMIT_KB ))KB)"
    FAILED=1
  else
    echo "PASS  $name — ${size_kb}KB (limit: ${LIMIT_KB}KB)"
  fi
done

echo "---"

if [ "$FAILED" -eq 1 ]; then
  echo "One or more contracts exceed the WASM size budget."
  echo "To fix: audit new dependencies, use cargo bloat to find large contributors,"
  echo "or raise WASM_SIZE_LIMIT_KB in the workflow env if the increase is intentional."
  exit 1
fi

echo "All contracts within WASM size budget."
