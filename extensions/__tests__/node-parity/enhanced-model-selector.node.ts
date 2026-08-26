/**
 * Node parity target for enhanced model selector formatting helpers.
 *
 * The historical Bun source remains at extensions/__tests__/enhanced-model-selector.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

function fmtNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
	return String(n);
}

function fmtCost(c: { input: number; output: number }): string {
	const input = c.input === 0 ? "?" : `$${c.input.toFixed(2)}`;
	const output = c.output === 0 ? "?" : `$${c.output.toFixed(2)}`;
	return `${input}/${output}`;
}

type ModelThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

function fmtLevels(levels: readonly ModelThinkingLevel[]): string {
	if (levels.length === 1 && levels[0] === "off") return "—";
	const short: Record<string, string> = {
		off: "off",
		minimal: "min",
		low: "low",
		medium: "med",
		high: "high",
		xhigh: "xhi",
	};
	return levels.map((level) => short[level] ?? level).join(",");
}

function padR(value: string, minimum: number): string {
	if (value.length >= minimum) return value;
	return value + " ".repeat(minimum - value.length);
}

describe("enhanced-model-selector helpers", () => {
	test("formats numbers", () => {
		assert.strictEqual(fmtNum(0), "0");
		assert.strictEqual(fmtNum(42), "42");
		assert.strictEqual(fmtNum(999), "999");
		assert.strictEqual(fmtNum(1_000), "1K");
		assert.strictEqual(fmtNum(4_096), "4K");
		assert.strictEqual(fmtNum(128_000), "128K");
		assert.strictEqual(fmtNum(999_999), "1000K");
		assert.strictEqual(fmtNum(1_000_000), "1.0M");
		assert.strictEqual(fmtNum(2_500_000), "2.5M");
		assert.strictEqual(fmtNum(10_000_000), "10.0M");
	});

	test("formats costs", () => {
		assert.strictEqual(fmtCost({ input: 0, output: 0 }), "?/?");
		assert.strictEqual(fmtCost({ input: 0.15, output: 0.6 }), "$0.15/$0.60");
		assert.strictEqual(fmtCost({ input: 0, output: 2 }), "?/$2.00");
		assert.strictEqual(fmtCost({ input: 3, output: 0 }), "$3.00/?");
		assert.strictEqual(fmtCost({ input: 0.01, output: 0.05 }), "$0.01/$0.05");
	});

	test("formats thinking levels", () => {
		assert.strictEqual(fmtLevels(["off"]), "—");
		assert.strictEqual(fmtLevels(["off", "minimal"]), "off,min");
		assert.strictEqual(fmtLevels(["low", "medium", "high"]), "low,med,high");
		assert.strictEqual(
			fmtLevels(["off", "low", "medium", "high", "xhigh"]),
			"off,low,med,high,xhi",
		);
		assert.strictEqual(fmtLevels([]), "");
	});

	test("pads strings to minimum width", () => {
		assert.strictEqual(padR("hi", 5), "hi   ");
		assert.strictEqual(padR("hello", 5), "hello");
		assert.strictEqual(padR("hello world", 5), "hello world");
		assert.strictEqual(padR("", 3), "   ");
	});

	test("padR edge cases", () => {
		assert.strictEqual(padR("a", 0), "a");
		assert.strictEqual(padR("test", 4), "test");
		assert.strictEqual(padR("x", 1), "x");
	});
});
