import { describe, expect, test } from "bun:test";
import { realpathSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DOTPI = "/Users/famillesendrison/Developper/Projects/dotpi";
const AGENT = "/Users/famillesendrison/.pi/agent";

function wouldBlock(givenPath: string): { block: boolean; reason?: string } {
  let real: string;
  try {
    real = realpathSync(givenPath);
  } catch {
    try {
      const parent = givenPath.replace(/\/[^/]+$/, "") || "/";
      if (!existsSync(parent)) return { block: false };
      real = realpathSync(parent) + "/" + givenPath.split("/").pop();
    } catch {
      return { block: false };
    }
  }

  if (real.startsWith(DOTPI + "/") || real === DOTPI) {
    if (!givenPath.startsWith(AGENT)) {
      return {
        block: true,
        reason:
          `Write through ~/.pi/agent/, not directly to dotpi/.\n` +
          `  Given:  ${givenPath}\n` +
          `  Use:    ${givenPath.replace(DOTPI, AGENT)}`,
      };
    }
  }
  return { block: false };
}

describe("path-guard", () => {
  test("allows writes through ~/.pi/agent/", () => {
    const r = wouldBlock(AGENT + "/extensions/command-validator.ts");
    expect(r.block).toBe(false);
  });

  test("blocks writes directly to dotpi/", () => {
    const r = wouldBlock(DOTPI + "/extensions/command-validator.ts");
    expect(r.block).toBe(true);
    expect(r.reason).toContain("Write through ~/.pi/agent/");
    expect(r.reason).toContain(AGENT + "/extensions/command-validator.ts");
  });

  test("blocks writes to dotpi/ subdirectories", () => {
    expect(wouldBlock(DOTPI + "/docs/CONTEXT.md").block).toBe(true);
    expect(wouldBlock(DOTPI + "/patches/enhanced-model-selector/apply.sh").block).toBe(true);
    expect(wouldBlock(DOTPI + "/CONTEXT.md").block).toBe(true);
  });

  test("allows writes outside dotpi/ entirely", () => {
    expect(wouldBlock("/tmp/test.txt").block).toBe(false);
    expect(wouldBlock("/Users/famillesendrison/other/file.ts").block).toBe(false);
  });

  test("allows writes to non-existent files outside dotpi/", () => {
    expect(wouldBlock("/tmp/does-not-exist-yet.ts").block).toBe(false);
  });

  test("shows the correct ~/.pi/agent path in error message", () => {
    const given = DOTPI + "/extensions/foo.ts";
    const expected = AGENT + "/extensions/foo.ts";
    const r = wouldBlock(given);
    expect(r.reason).toContain(expected);
  });
});
