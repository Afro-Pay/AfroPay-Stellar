#!/bin/bash

# Build WASM binary
echo "🔨 Building WASM binary..."
cargo build --target wasm32-unknown-unknown --release

# Check binary size
WASM_PATH="target/wasm32-unknown-unknown/release/escrow.wasm"
if [ -f "$WASM_PATH" ]; then
    SIZE=$(ls -l "$WASM_PATH" | awk '{print $5}')
    SIZE_KB=$((SIZE / 1024))
    
    echo "📦 WASM Binary Size: ${SIZE_KB}KB"
    
    if [ $SIZE_KB -lt 30 ]; then
        echo "✅ Binary size is under 30KB!"
        exit 0
    else
        echo "⚠️ Binary size is ${SIZE_KB}KB (target: <30KB)"
        exit 1
    fi
else
    echo "❌ WASM binary not found at $WASM_PATH"
    exit 1
fi
