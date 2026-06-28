import { describe, expect, test } from "bun:test";
import { realpathSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOME = "/Users/famillesendrison";
const PROJECTS = join(HOME, "Developper", "Projects");

function wouldBlock(givenPath: string): { block: boolean; reason?: string } {
  let real: string;
  try {
    real = realpathSync(givenPath);
  } catch {
    let ancestor = givenPath.replace(/\/[^/]+$/, "") || "/";
    while (ancestor && !existsSync(ancestor)) {
      ancestor = ancestor.replace(/\/[^/]+$/, "") || "/";
    }
    if (!ancestor || !existsSync(ancestor)) return { block: false };
    const rel = givenPath.slice(ancestor.length + 1);
    real = realpathSync(ancestor) + "/" + rel;
  }

  if (!real.startsWith(PROJECTS + "/")) return { block: false };

  const relative = real.slice(PROJECTS.length + 1);
  const slashIdx = relative.indexOf("/");
  const repoDir = slashIdx === -1 ? relative : relative.slice(0, slashIdx);

  if (!repoDir.startsWith("dot")) return { block: false };

  const name = repoDir.slice(3);
  const gateway = join(HOME, "." + name);

  if (!givenPath.startsWith(gateway)) {
    return {
      block: true,
      reason:
        `Write through ~/.${name}/, not directly to ${repoDir}/.\n` +
        `  Given:  ${givenPath}\n` +
        `  Use:    ~/.${name}/${relative.slice(repoDir.length + 1)}`,
    };
  }
  return { block: false };
}

describe("path-guard", () => {
  // ── dotpi → ~/.pi ─────────────────────────────────────────────────────
  test("allows writes through ~/.pi/", () => {
    expect(wouldBlock(HOME + "/.pi/agent/extensions/command-validator.ts").block).toBe(false);
    expect(wouldBlock(HOME + "/.pi/agent/CONTEXT.md").block).toBe(false);
  });

  test("blocks writes directly to dotpi/", () => {
    expect(wouldBlock(join(PROJECTS, "dotpi/extensions/command-validator.ts")).block).toBe(true);
    expect(wouldBlock(join(PROJECTS, "dotpi/CONTEXT.md")).block).toBe(true);
  });

  // ── dotagents → ~/.agents ─────────────────────────────────────────────
  test("allows writes through ~/.agents/", () => {
    expect(wouldBlock(HOME + "/.agents/agent-hooks/command-validator/src/core/validator.ts").block).toBe(false);
  });

  test("blocks writes directly to dotagents/", () => {
    expect(wouldBlock(join(PROJECTS, "dotagents/agent-hooks/command-validator/src/core/validator.ts")).block).toBe(true);
  });

  // ── dotclaude → ~/.claude ─────────────────────────────────────────────
  test("allows writes through ~/.claude/", () => {
    expect(wouldBlock(HOME + "/.claude/scripts/some-file.ts").block).toBe(false);
  });

  test("blocks writes directly to dotclaude/", () => {
    expect(wouldBlock(join(PROJECTS, "dotclaude/some-file.ts")).block).toBe(true);
  });

  // ── outside Projects/ ─────────────────────────────────────────────────
  test("allows writes outside Projects/", () => {
    expect(wouldBlock("/tmp/test.txt").block).toBe(false);
    expect(wouldBlock(HOME + "/other/file.ts").block).toBe(false);
  });

  test("allows writes to non-dot repos under Projects/", () => {
    // If there were a Projects/notadot/ repo, it would pass through
    expect(wouldBlock(join(PROJECTS, "notadot/file.ts")).block).toBe(false);
  });

  // ── error message ─────────────────────────────────────────────────────
  test("error message shows the gateway path", () => {
    const r = wouldBlock(join(PROJECTS, "dotpi/docs/CONTEXT.md"));
    expect(r.block).toBe(true);
    expect(r.reason).toContain("~/.pi/");
    expect(r.reason).toContain("dotpi/");
    expect(r.reason).toContain("docs/CONTEXT.md");
  });

  // ── non-existent files under known repos ──────────────────────────────
  test("blocks non-existent files inside dot* repos", () => {
    // File doesn't exist but its repo root does
    expect(wouldBlock(join(PROJECTS, "dotpi/new-folder/new-file.ts")).block).toBe(true);
  });
});
