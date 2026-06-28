import { describe, expect, test } from "bun:test";

// Extract pure helpers from the extension (no Pi runtime needed)

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtCost(c: { input: number; output: number }): string {
  const in_ = c.input === 0 ? "?" : `$${c.input.toFixed(2)}`;
  const out = c.output === 0 ? "?" : `$${c.output.toFixed(2)}`;
  return `${in_}/${out}`;
}

type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

function fmtLevels(levels: readonly ModelThinkingLevel[]): string {
  if (levels.length === 1 && levels[0] === "off") return "—";
  const short: Record<string, string> = {
    off: "off", minimal: "min", low: "low",
    medium: "med", high: "high", xhigh: "xhi",
  };
  return levels.map((l) => short[l] ?? l).join(",");
}

function padR(s: string, min: number): string {
  if (s.length >= min) return s;
  return s + " ".repeat(min - s.length);
}

describe("enhanced-model-selector helpers", () => {
  // ── fmtNum ─────────────────────────────────────────────────────────────
  test("formats numbers", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(42)).toBe("42");
    expect(fmtNum(999)).toBe("999");
    expect(fmtNum(1_000)).toBe("1K");
    expect(fmtNum(4_096)).toBe("4K");
    expect(fmtNum(128_000)).toBe("128K");
    expect(fmtNum(999_999)).toBe("1000K");
    expect(fmtNum(1_000_000)).toBe("1.0M");
    expect(fmtNum(2_500_000)).toBe("2.5M");
    expect(fmtNum(10_000_000)).toBe("10.0M");
  });

  // ── fmtCost ────────────────────────────────────────────────────────────
  test("formats costs", () => {
    expect(fmtCost({ input: 0, output: 0 })).toBe("?/?");
    expect(fmtCost({ input: 0.15, output: 0.60 })).toBe("$0.15/$0.60");
    expect(fmtCost({ input: 0, output: 2.00 })).toBe("?/$2.00");
    expect(fmtCost({ input: 3.00, output: 0 })).toBe("$3.00/?");
    expect(fmtCost({ input: 0.01, output: 0.05 })).toBe("$0.01/$0.05");
  });

  // ── fmtLevels ──────────────────────────────────────────────────────────
  test("formats thinking levels", () => {
    expect(fmtLevels(["off"])).toBe("—");
    expect(fmtLevels(["off", "minimal"])).toBe("off,min");
    expect(fmtLevels(["low", "medium", "high"])).toBe("low,med,high");
    expect(fmtLevels(["off", "low", "medium", "high", "xhigh"])).toBe("off,low,med,high,xhi");
    expect(fmtLevels([])).toBe("");
  });

  // ── padR ───────────────────────────────────────────────────────────────
  test("pads strings to minimum width", () => {
    expect(padR("hi", 5)).toBe("hi   ");
    expect(padR("hello", 5)).toBe("hello");
    expect(padR("hello world", 5)).toBe("hello world");
    expect(padR("", 3)).toBe("   ");
  });

  test("padR edge cases", () => {
    expect(padR("a", 0)).toBe("a");
    expect(padR("test", 4)).toBe("test");
    expect(padR("x", 1)).toBe("x");
  });
});
