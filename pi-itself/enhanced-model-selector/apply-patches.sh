#!/usr/bin/env bash
# apply-patches.sh — Apply all pi dist patches from pi-itself/
#
# Usage: ./pi-itself/enhanced-model-selector/apply-patches.sh
#
# This script finds the globally installed pi-coding-agent package and applies
# the git-tracked patches. Re-run after `pi update` or `npm update -g`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find the pi-coding-agent package root (works with nvm, fnm, global npm)
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
    echo "ERROR: Could not find pi-coding-agent package. Is pi installed?"
    exit 1
fi

echo "→ pi package root: $PACKAGE_ROOT"
echo ""

apply_one() {
    local patch_file="$1"
    local patch_name
    patch_name="$(basename "$patch_file")"

    # Quick check if already applied
    if grep -q "PATCHED by enhanced-model-selector" "$PACKAGE_ROOT/dist/modes/interactive/interactive-mode.js" 2>/dev/null; then
        echo "✓ $patch_name — already applied, skipping"
        return 0
    fi

    echo "  Applying $patch_name..."
    cd "$PACKAGE_ROOT"
    if patch -p1 --dry-run < "$patch_file" > /dev/null 2>&1; then
        patch -p1 < "$patch_file"
        echo "  ✓ $patch_name — applied successfully"
    else
        echo "  ✗ $patch_name — FAILED (dry-run). The dist file may have changed upstream."
        echo "    Check the patch and dist file manually:"
        echo "      diff: $patch_file"
        echo "      dist: $PACKAGE_ROOT/dist/modes/interactive/interactive-mode.js"
        exit 1
    fi
}

# Apply all .patch files in pi-itself/ subdirectories
find "$SCRIPT_DIR/../.." -name "*.patch" -not -path "*/enhanced-model-selector/*" -prune -o -name "*.patch" -print | while read -r patch; do
    apply_one "$patch"
done

echo ""
echo "All patches applied."
