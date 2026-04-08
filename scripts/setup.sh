#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> Initializing submodules..."
git submodule update --init --recursive

echo "==> Checking for zig..."
if ! command -v zig &> /dev/null; then
    echo "Error: zig is not installed."
    echo "Install via: brew install zig"
    exit 1
fi

GHOSTTY_SHA="$(git -C ghostty rev-parse HEAD)"
CACHE_ROOT="${CMUX_GHOSTTYKIT_CACHE_DIR:-$HOME/.cache/cmux/ghosttykit}"
CACHE_DIR="$CACHE_ROOT/$GHOSTTY_SHA"
CACHE_XCFRAMEWORK="$CACHE_DIR/GhosttyKit.xcframework"
LOCAL_XCFRAMEWORK="$PROJECT_DIR/ghostty/macos/GhosttyKit.xcframework"
LOCAL_SHA_STAMP="$LOCAL_XCFRAMEWORK/.ghostty_sha"
LOCK_DIR="$CACHE_ROOT/$GHOSTTY_SHA.lock"

mkdir -p "$CACHE_ROOT"

echo "==> Ghostty submodule commit: $GHOSTTY_SHA"

LOCK_TIMEOUT=300
LOCK_START=$SECONDS
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if (( SECONDS - LOCK_START > LOCK_TIMEOUT )); then
        echo "==> Lock stale (>${LOCK_TIMEOUT}s), removing and retrying..."
        rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
        continue
    fi
    echo "==> Waiting for GhosttyKit cache lock for $GHOSTTY_SHA..."
    sleep 1
done
trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT

if [ -d "$CACHE_XCFRAMEWORK" ]; then
    echo "==> Reusing cached GhosttyKit.xcframework"
else
    # Only reuse local xcframework if its SHA stamp matches the current ghostty commit.
    # Without this check, a stale build from a previous commit could be cached under
    # the wrong SHA, producing ABI mismatches.
    LOCAL_SHA=""
    if [ -f "$LOCAL_SHA_STAMP" ]; then
        LOCAL_SHA="$(cat "$LOCAL_SHA_STAMP")"
    fi

    if [ -d "$LOCAL_XCFRAMEWORK" ] && [ "$LOCAL_SHA" = "$GHOSTTY_SHA" ]; then
        echo "==> Seeding cache from existing local GhosttyKit.xcframework (SHA matches)"
    else
        # Try downloading pre-built xcframework from CI releases first (much faster).
        RELEASE_TAG="xcframework-${GHOSTTY_SHA}"
        DOWNLOAD_URL="https://github.com/manaflow-ai/ghostty/releases/download/${RELEASE_TAG}/GhosttyKit.xcframework.tar.gz"
        DOWNLOADED=false

        echo "==> Trying to download pre-built GhosttyKit.xcframework..."
        if curl -fSL --retry 2 --max-time 120 "$DOWNLOAD_URL" -o /tmp/GhosttyKit.xcframework.tar.gz 2>/dev/null; then
            echo "==> Downloaded pre-built xcframework, extracting..."
            rm -rf "$LOCAL_XCFRAMEWORK"
            mkdir -p "$(dirname "$LOCAL_XCFRAMEWORK")"
            tar xzf /tmp/GhosttyKit.xcframework.tar.gz -C ghostty/macos/
            rm -f /tmp/GhosttyKit.xcframework.tar.gz
            echo "$GHOSTTY_SHA" > "$LOCAL_SHA_STAMP"
            DOWNLOADED=true
        else
            echo "==> Pre-built xcframework not available for $GHOSTTY_SHA, building from source..."
        fi

        if [ "$DOWNLOADED" = false ]; then
            (
                cd ghostty
                zig build -Demit-xcframework=true -Dxcframework-target=universal -Doptimize=ReleaseFast
            )
            # Stamp the build output with the SHA it was built from
            echo "$GHOSTTY_SHA" > "$LOCAL_SHA_STAMP"
        fi
    fi

    if [ ! -d "$LOCAL_XCFRAMEWORK" ]; then
        echo "Error: GhosttyKit.xcframework not found at $LOCAL_XCFRAMEWORK"
        exit 1
    fi

    TMP_DIR="$(mktemp -d "$CACHE_ROOT/.ghosttykit-tmp.XXXXXX")"
    mkdir -p "$CACHE_DIR"
    cp -R "$LOCAL_XCFRAMEWORK" "$TMP_DIR/GhosttyKit.xcframework"
    rm -rf "$CACHE_XCFRAMEWORK"
    mv "$TMP_DIR/GhosttyKit.xcframework" "$CACHE_XCFRAMEWORK"
    rmdir "$TMP_DIR"
    echo "==> Cached GhosttyKit.xcframework at $CACHE_XCFRAMEWORK"
fi

echo "==> Creating symlink for GhosttyKit.xcframework..."
ln -sfn "$CACHE_XCFRAMEWORK" GhosttyKit.xcframework

echo "==> Setup complete!"
echo ""
echo "You can now build and run the app:"
echo "  ./scripts/reload.sh --tag first-run"
