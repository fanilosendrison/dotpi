#!/usr/bin/env bash
# revert.sh — Revert the context-section-color patch
#
# Usage: ./patches/context-section-color/revert.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find the pi-coding-agent package root
PACKAGE_ROOT=""
for candidate in \
    "$(dirname "$(which pi 2>/dev/null || true)")/.." \
    "$(npm root -g 2>/dev/null || true)/@earendil-works/pi-coding-agent"; do
    if [ -d "$candidate/dist" ]; then
        PACKAGE_ROOT="$candidate"
        break
    fi
done

if [ -z "$PACKAGE_ROOT" ]; then
    echo "ERROR: Could not find pi-coding-agent package."
    exit 1
fi

TARGET="$PACKAGE_ROOT/dist/modes/interactive/interactive-mode.js"

if ! grep -q "PATCHED by context-section-color" "$TARGET" 2>/dev/null; then
    echo "Patch not applied, nothing to revert."
    exit 0
fi

echo "Reverting patch in $TARGET ..."
cd "$PACKAGE_ROOT"
patch -p1 -R < "$SCRIPT_DIR/interactive-mode.patch"
echo "✓ Patch reverted."
