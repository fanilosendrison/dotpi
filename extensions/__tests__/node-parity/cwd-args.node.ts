/**
 * Node parity target for cwd argument and WezTerm argument helpers.
 *
 * The retired source path was extensions/__tests__/cwd-args.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCwdArgs } from "../../cwd-internals/args.ts";
import {
	buildWezTermArgs,
	resolveInteractiveBrowserStartPath,
} from "../../cwd-internals/wezterm.ts";
import { PREFERRED_BROWSER_START_PATH } from "../cwd-test-helpers.ts";

describe("parseCwdArgs", () => {
	test("defaults to bottom split in the current directory", () => {
		assert.deepStrictEqual(parseCwdArgs(""), {
			ok: true,
			splitType: "--bottom",
			directoryArgument: ".",
		});
	});

	test("accepts the split flag before the directory", () => {
		assert.deepStrictEqual(parseCwdArgs("--right ../project"), {
			ok: true,
			splitType: "--right",
			directoryArgument: "../project",
		});
	});

	test("accepts the split flag after the directory", () => {
		assert.deepStrictEqual(parseCwdArgs("../project --left"), {
			ok: true,
			splitType: "--left",
			directoryArgument: "../project",
		});
	});

	test("keeps unquoted paths with spaces as a single directory argument", () => {
		assert.deepStrictEqual(parseCwdArgs("my project --tab"), {
			ok: true,
			splitType: "--tab",
			directoryArgument: "my project",
		});
	});

	test("keeps quoted paths with spaces as a single directory argument", () => {
		assert.deepStrictEqual(parseCwdArgs('--top "my project"'), {
			ok: true,
			splitType: "--top",
			directoryArgument: "my project",
		});
	});

	test("rejects invalid split flags", () => {
		assert.deepStrictEqual(parseCwdArgs("--diagonal ."), {
			ok: false,
			message:
				"Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab",
		});
	});
});

describe("buildWezTermArgs", () => {
	for (const splitType of [
		"--bottom",
		"--top",
		"--right",
		"--left",
		"--horizontal",
	] as const) {
		test(`builds split-pane args for ${splitType}`, () => {
			assert.deepStrictEqual(buildWezTermArgs(splitType, "/tmp/project"), [
				"cli",
				"split-pane",
				splitType,
				"--cwd",
				"/tmp/project",
				"--",
				"pi",
			]);
		});
	}

	test("translates vertical to bottom for the current WezTerm CLI", () => {
		assert.deepStrictEqual(buildWezTermArgs("--vertical", "/tmp/project"), [
			"cli",
			"split-pane",
			"--bottom",
			"--cwd",
			"/tmp/project",
			"--",
			"pi",
		]);
	});

	test("builds spawn args for tabs", () => {
		assert.deepStrictEqual(buildWezTermArgs("--tab", "/tmp/project"), [
			"cli",
			"spawn",
			"--cwd",
			"/tmp/project",
			"--",
			"pi",
		]);
	});
});

describe("resolveInteractiveBrowserStartPath", () => {
	test("prefers the projects directory when it exists", () => {
		assert.strictEqual(
			resolveInteractiveBrowserStartPath(
				"/tmp/current",
				(candidate) => candidate === PREFERRED_BROWSER_START_PATH,
			),
			PREFERRED_BROWSER_START_PATH,
		);
	});

	test("falls back to the current cwd when the projects directory is missing", () => {
		assert.strictEqual(
			resolveInteractiveBrowserStartPath("/tmp/current", () => false),
			"/tmp/current",
		);
	});
});
