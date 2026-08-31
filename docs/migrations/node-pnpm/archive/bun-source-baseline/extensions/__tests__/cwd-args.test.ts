import { describe, expect, test } from "bun:test";
import { PREFERRED_BROWSER_START_PATH } from "./cwd-test-helpers";
import { parseCwdArgs } from "../cwd-internals/args";
import { buildWezTermArgs, resolveInteractiveBrowserStartPath } from "../cwd-internals/wezterm";

describe("parseCwdArgs", () => {
	test("defaults to bottom split in the current directory", () => {
		expect(parseCwdArgs("")).toEqual({
			ok: true,
			splitType: "--bottom",
			directoryArgument: ".",
		});
	});

	test("accepts the split flag before the directory", () => {
		expect(parseCwdArgs("--right ../project")).toEqual({
			ok: true,
			splitType: "--right",
			directoryArgument: "../project",
		});
	});

	test("accepts the split flag after the directory", () => {
		expect(parseCwdArgs("../project --left")).toEqual({
			ok: true,
			splitType: "--left",
			directoryArgument: "../project",
		});
	});

	test("keeps unquoted paths with spaces as a single directory argument", () => {
		expect(parseCwdArgs("my project --tab")).toEqual({
			ok: true,
			splitType: "--tab",
			directoryArgument: "my project",
		});
	});

	test("keeps quoted paths with spaces as a single directory argument", () => {
		expect(parseCwdArgs('--top "my project"')).toEqual({
			ok: true,
			splitType: "--top",
			directoryArgument: "my project",
		});
	});

	test("rejects invalid split flags", () => {
		expect(parseCwdArgs("--diagonal .")).toEqual({
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
			expect(buildWezTermArgs(splitType, "/tmp/project")).toEqual([
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
		expect(buildWezTermArgs("--vertical", "/tmp/project")).toEqual([
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
		expect(buildWezTermArgs("--tab", "/tmp/project")).toEqual([
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
		expect(
			resolveInteractiveBrowserStartPath("/tmp/current", (candidate) => candidate === PREFERRED_BROWSER_START_PATH),
		).toBe(PREFERRED_BROWSER_START_PATH);
	});

	test("falls back to the current cwd when the projects directory is missing", () => {
		expect(resolveInteractiveBrowserStartPath("/tmp/current", () => false)).toBe("/tmp/current");
	});
});
