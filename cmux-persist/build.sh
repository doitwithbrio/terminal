#!/bin/bash
# Build cmux-persist binary
# Works around Zig 0.15 build runner linking issue on macOS
set -euo pipefail

cd "$(dirname "$0")"

OPTIMIZE="${1:-ReleaseFast}"
SYSROOT="$(xcrun --show-sdk-path)"
OUT_DIR="zig-out/bin"

mkdir -p "$OUT_DIR"

# Try `zig build` first (works when Zig build runner links correctly)
if zig build "-Doptimize=${OPTIMIZE}" 2>/dev/null; then
    echo "Built via zig build"
    exit 0
fi

# Fallback: compile object + link with system cc
echo "zig build failed (known macOS issue), using fallback build..."
zig build-obj src/main.zig \
    --sysroot "$SYSROOT" \
    -lc \
    "-Doptimize=${OPTIMIZE}"

cc main.o -o "$OUT_DIR/cmux-persist" -lutil
rm -f main.o

echo "Built: $OUT_DIR/cmux-persist"
