import { describe, expect, test } from "bun:test";
import { realpathSync, existsSync } from "node:fs";

const HOME = "/Users/famillesendrison";
const GUARDED: Array<{ real: string; gateway: string; label: string }> = [
  { real: `${HOME}/Developper/Projects/dotpi`, gateway: `${HOME}/.pi/agent`, label: "dotpi" },
  { real: `${HOME}/Developper/Projects/dotagents`, gateway: `${HOME}/.agents`, label: "dotagents" },
  { real: `${HOME}/Developper/Projects/dotclaude`, gateway: `${HOME}/.claude`, label: "dotclaude" },
];

function wouldBlock(givenPath: string): { block: boolean; reason?: string } {
  let real: string;
  try {
    real = realpathSync(givenPath);
  } catch {
    // Walk up to first existing ancestor
    let ancestor = givenPath.replace(/\/[^/]+$/, "") || "/";
    while (ancestor && !existsSync(ancestor)) {
      ancestor = ancestor.replace(/\/[^/]+$/, "") || "/";
    }
    if (!ancestor || !existsSync(ancestor)) return { block: false };
    const rel = givenPath.slice(ancestor.length + 1);
    real = realpathSync(ancestor) + "/" + rel;
  }

  for (const g of GUARDED) {
    if (real.startsWith(g.real + "/") || real === g.real) {
      if (!givenPath.startsWith(g.gateway)) {
        return {
          block: true,
          reason:
            `Write through ${g.gateway}, not directly to ${g.label}/.\n` +
            `  Given:  ${givenPath}\n` +
            `  Use:    ${givenPath.replace(g.real, g.gateway)}`,
        };
      }
    }
  }
  return { block: false };
}

describe("path-guard", () => {
  // ── dotpi ──────────────────────────────────────────────────────────────
  test("allows writes through ~/.pi/agent/", () => {
    expect(wouldBlock(HOME + "/.pi/agent/extensions/command-validator.ts").block).toBe(false);
  });

  test("blocks writes directly to dotpi/", () => {
    const r = wouldBlock(HOME + "/Developper/Projects/dotpi/extensions/command-validator.ts");
    expect(r.block).toBe(true);
    expect(r.reason).toContain("dotpi");
  });

  // ── dotagents ──────────────────────────────────────────────────────────
  test("allows writes through ~/.agents/", () => {
    expect(wouldBlock(HOME + "/.agents/agent-hooks/command-validator/src/core/validator.ts").block).toBe(false);
  });

  test("blocks writes directly to dotagents/", () => {
    const r = wouldBlock(HOME + "/Developper/Projects/dotagents/agent-hooks/command-validator/src/core/validator.ts");
    expect(r.block).toBe(true);
    expect(r.reason).toContain("dotagents");
  });

  // ── dotclaude ──────────────────────────────────────────────────────────
  test("allows writes through ~/.claude/", () => {
    expect(wouldBlock(HOME + "/.claude/scripts/some-file.ts").block).toBe(false);
  });

  test("blocks writes directly to dotclaude/", () => {
    const r = wouldBlock(HOME + "/Developper/Projects/dotclaude/some-file.ts");
    expect(r.block).toBe(true);
    expect(r.reason).toContain("dotclaude");
  });

  // ── outside all repos ──────────────────────────────────────────────────
  test("allows writes outside guarded repos", () => {
    expect(wouldBlock("/tmp/test.txt").block).toBe(false);
    expect(wouldBlock(HOME + "/other/file.ts").block).toBe(false);
  });

  test("shows the correct gateway path in error for each repo", () => {
    for (const g of GUARDED) {
      const given = g.real + "/some/file.ts";
      const r = wouldBlock(given);
      expect(r.block).toBe(true);
      expect(r.reason).toContain(g.gateway);
      expect(r.reason).toContain(given.replace(g.real, g.gateway));
    }
  });
});
