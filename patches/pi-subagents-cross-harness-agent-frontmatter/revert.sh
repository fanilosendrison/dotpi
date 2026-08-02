#!/usr/bin/env bash
# Revert the Pi-specific frontmatter overlay from pi-subagents 0.35.1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/cross-harness-agent-frontmatter.patch"
EXTENSION_DIR="${PI_SUBAGENTS_EXTENSION_DIR:-"$HOME/.pi/agent/extensions/pi-subagents-4-turnlock"}"
PACKAGE_JSON="$EXTENSION_DIR/package.json"

fail() {
	echo "ERROR: $*" >&2
	exit 1
}

[ -f "$PATCH_FILE" ] || fail "Patch file is missing: $PATCH_FILE"
[ -f "$PACKAGE_JSON" ] || fail "pi-subagents package.json was not found: $PACKAGE_JSON"
[ -f "$EXTENSION_DIR/src/agents/agents.ts" ] || fail "Target source file is missing: $EXTENSION_DIR/src/agents/agents.ts"

node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (pkg.name !== "pi-subagents" || pkg.version !== "0.35.1") process.exit(1);
' "$PACKAGE_JSON" || fail "Unsupported pi-subagents target."

cd "$EXTENSION_DIR"
if patch -p1 -R --dry-run < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "→ Reverting cross-harness frontmatter patch from $EXTENSION_DIR"
	patch -p1 -R < "$PATCH_FILE"
	echo "✓ Cross-harness frontmatter patch reverted."
elif patch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "✓ Cross-harness frontmatter patch is not applied."
else
	fail "Patch context does not match pi-subagents 0.35.1. Refuse to modify the target."
fi
