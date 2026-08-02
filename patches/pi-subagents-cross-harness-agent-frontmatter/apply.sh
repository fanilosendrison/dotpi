#!/usr/bin/env bash
# Apply the Pi-specific frontmatter overlay to pi-subagents 0.35.1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/cross-harness-agent-frontmatter.patch"
VERIFY_FILE="$SCRIPT_DIR/verify-cross-harness-agent.test.mjs"
EXTENSION_DIR="${PI_SUBAGENTS_EXTENSION_DIR:-"$HOME/.pi/agent/extensions/pi-subagents-4-turnlock"}"
PACKAGE_JSON="$EXTENSION_DIR/package.json"
APPLIED_NOW=false

fail() {
	echo "ERROR: $*" >&2
	exit 1
}

[ -f "$PATCH_FILE" ] || fail "Patch file is missing: $PATCH_FILE"
[ -f "$VERIFY_FILE" ] || fail "Verifier is missing: $VERIFY_FILE"
[ -f "$PACKAGE_JSON" ] || fail "pi-subagents package.json was not found: $PACKAGE_JSON"
[ -f "$EXTENSION_DIR/src/agents/agents.ts" ] || fail "Target source file is missing: $EXTENSION_DIR/src/agents/agents.ts"

node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (pkg.name !== "pi-subagents") {
	process.stderr.write(`Expected package name pi-subagents, received ${String(pkg.name)}.\n`);
	process.exit(1);
}
if (pkg.version !== "0.35.1") {
	process.stderr.write(`Expected pi-subagents 0.35.1, received ${String(pkg.version)}. Update the patch deliberately for this version.\n`);
	process.exit(1);
}
' "$PACKAGE_JSON" || fail "Unsupported pi-subagents target."

cd "$EXTENSION_DIR"
if patch -p1 -R --dry-run < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "✓ Cross-harness frontmatter patch is already applied."
elif patch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1; then
	echo "→ Applying cross-harness frontmatter patch to $EXTENSION_DIR"
	patch -p1 < "$PATCH_FILE"
	APPLIED_NOW=true
else
	fail "Patch context does not match pi-subagents 0.35.1. Refuse to modify the target."
fi

if PI_SUBAGENTS_EXTENSION_DIR="$EXTENSION_DIR" node --experimental-strip-types --test "$VERIFY_FILE"; then
	echo "✓ Cross-harness frontmatter verification passed."
	exit 0
fi

if [ "$APPLIED_NOW" = true ]; then
	echo "Verification failed; reverting the patch applied during this run." >&2
	if ! patch -p1 -R < "$PATCH_FILE"; then
		echo "ERROR: Automatic rollback failed; inspect $EXTENSION_DIR manually." >&2
	fi
fi
fail "Cross-harness frontmatter verification failed."
