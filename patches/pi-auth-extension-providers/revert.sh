#!/usr/bin/env bash
# Revert extension-registered provider support from Pi 0.84.2 auth commands.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/auth-extension-providers.patch"
EXPECTED_PACKAGE_NAME="@earendil-works/pi-coding-agent"
EXPECTED_PACKAGE_VERSION="0.84.2"
TARGET_FILES=("dist/main.js" "dist/core/agent-session-services.js" "dist/core/agent-session-services.d.ts")
PREIMAGE_SHA256=(
	"5b340ce4b2030da40421d8a7940337f0568a927b0c2c981156733b4e067b9486"
	"3a4ee476b0596f346023398f52176381355f98dd621b8161f269c7ef3a57e28f"
	"ab5dac8701f02587db54abc27d119ea44ebd3708f235d5daf8293abd7b2ea71e"
)
POSTIMAGE_SHA256=(
	"24dd0e6e1c0ebf30df06d82d46e59c5276c8743c9e319ff31b9aa7a715752f53"
	"a3ae158ca07fc2f7dc8d059240b6cf3be89ebee826716147cf9424fbd8b1f6f4"
	"2f49a090f760885369baa45ab7be20fd7bac1d6a43c2d9da26f04b4e372f74e9"
)
BACKUP_DIR=""
MUTATION_ACTIVE=false
ROLLBACK_STATE="postimage"

fail() {
	echo "ERROR: $*" >&2
	exit 1
}

sha256() {
	shasum -a 256 "$1" | awk '{print $1}'
}

resolve_default_package_dir() {
	local pi_executable
	pi_executable="$(command -v pi)" || fail "The pi executable was not found on PATH."
	node - "$pi_executable" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const executable = fs.realpathSync(process.argv[2]);
if (path.basename(executable) !== "cli.js" || path.basename(path.dirname(executable)) !== "dist") {
	process.stderr.write(`Expected the pi executable to resolve to dist/cli.js, received ${executable}.\n`);
	process.exit(1);
}
process.stdout.write(path.dirname(path.dirname(executable)));
NODE
}

verify_state() {
	local state="$1"
	local index expected
	for index in "${!TARGET_FILES[@]}"; do
		if [ "$state" = "preimage" ]; then
			expected="${PREIMAGE_SHA256[$index]}"
		else
			expected="${POSTIMAGE_SHA256[$index]}"
		fi
		[ "$(sha256 "$PACKAGE_DIR/${TARGET_FILES[$index]}")" = "$expected" ] || return 1
	done
}

detect_state() {
	if verify_state "preimage"; then
		echo "preimage"
	elif verify_state "postimage"; then
		echo "postimage"
	else
		echo "unsupported"
	fi
}

backup_targets() {
	local index
	BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-auth-extension-providers.XXXXXX")"
	for index in "${!TARGET_FILES[@]}"; do
		cp -p "$PACKAGE_DIR/${TARGET_FILES[$index]}" "$BACKUP_DIR/$index"
	done
}

restore_backups() {
	local index
	[ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ] || return 1
	for index in "${!TARGET_FILES[@]}"; do
		cp -p "$BACKUP_DIR/$index" "$PACKAGE_DIR/${TARGET_FILES[$index]}" || return 1
	done
	verify_state "$ROLLBACK_STATE"
}

cleanup_backups() {
	local index
	if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
		for index in "${!TARGET_FILES[@]}"; do
			rm -f "$BACKUP_DIR/$index"
		done
		rmdir "$BACKUP_DIR" 2>/dev/null || true
	fi
}

on_exit() {
	local exit_code=$?
	trap - EXIT INT TERM HUP
	if [ "$MUTATION_ACTIVE" = true ]; then
		if restore_backups; then
			echo "Automatic rollback restored the supported $ROLLBACK_STATE." >&2
		else
			echo "ERROR: Automatic rollback could not restore the supported $ROLLBACK_STATE; inspect $PACKAGE_DIR manually." >&2
		fi
	fi
	cleanup_backups
	exit "$exit_code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[ -f "$PATCH_FILE" ] || fail "Patch file is missing: $PATCH_FILE"
PACKAGE_DIR="${PI_AUTH_PACKAGE_DIR:-$(resolve_default_package_dir)}"
PACKAGE_DIR="$(cd "$PACKAGE_DIR" 2>/dev/null && pwd)" || fail "Pi package directory was not found: $PACKAGE_DIR"
PACKAGE_JSON="$PACKAGE_DIR/package.json"
[ -f "$PACKAGE_JSON" ] || fail "Pi package.json was not found: $PACKAGE_JSON"
for target_file in "${TARGET_FILES[@]}"; do
	[ -f "$PACKAGE_DIR/$target_file" ] || fail "Pi patch target was not found: $PACKAGE_DIR/$target_file"
done

node - "$PACKAGE_JSON" "$EXPECTED_PACKAGE_NAME" "$EXPECTED_PACKAGE_VERSION" <<'NODE'
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (pkg.name !== process.argv[3] || pkg.version !== process.argv[4]) {
	process.stderr.write(`Expected ${process.argv[3]}@${process.argv[4]}, received ${String(pkg.name)}@${String(pkg.version)}. Update the patch deliberately for this version.\n`);
	process.exit(1);
}
NODE

current_state="$(detect_state)"
cd "$PACKAGE_DIR"
if [ "$current_state" = "preimage" ]; then
	patch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1 || fail "Supported preimages no longer accept the forward patch."
	echo "✓ Pi auth extension-provider patch is not applied."
	exit 0
fi
[ "$current_state" = "postimage" ] || fail "Pi auth patch targets are neither the supported Pi 0.84.2 preimages nor the exact patched postimages."
patch -p1 -R --dry-run < "$PATCH_FILE" >/dev/null 2>&1 || fail "Patch does not reverse cleanly from the supported postimages."

backup_targets
MUTATION_ACTIVE=true
echo "→ Reverting Pi auth extension-provider patch from $PACKAGE_DIR"
patch -p1 -R < "$PATCH_FILE" || fail "Patch reversion failed."
verify_state "preimage" || fail "Reverted files did not match the supported preimages."
patch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1 || fail "Reverted files no longer accept the forward patch."
MUTATION_ACTIVE=false
cleanup_backups
BACKUP_DIR=""
echo "✓ Pi auth extension-provider patch reverted and verified."
