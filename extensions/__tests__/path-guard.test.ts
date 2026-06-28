import { describe, expect, test } from "bun:test";
import { checkPath } from "../../../dotagents/agent-hooks/path-guard/src/core/path-guard";
import { join } from "node:path";

const HOME = "/Users/famillesendrison";
const PROJECTS = join(HOME, "Developper", "Projects");

describe("path-guard / checkPath", () => {
  // ── dotpi → ~/.pi ─────────────────────────────────────────────────────
  test("allows writes through ~/.pi/", () => {
    expect(checkPath(HOME + "/.pi/agent/extensions/command-validator.ts").allowed).toBe(true);
    expect(checkPath(HOME + "/.pi/agent/CONTEXT.md").allowed).toBe(true);
  });

  test("blocks writes directly to dotpi/", () => {
    expect(checkPath(join(PROJECTS, "dotpi/extensions/command-validator.ts")).allowed).toBe(false);
    expect(checkPath(join(PROJECTS, "dotpi/CONTEXT.md")).allowed).toBe(false);
  });

  // ── dotagents → ~/.agents ─────────────────────────────────────────────
  test("allows writes through ~/.agents/", () => {
    expect(checkPath(HOME + "/.agents/agent-hooks/shared/core/path-guard.ts").allowed).toBe(true);
  });

  test("blocks writes directly to dotagents/", () => {
    expect(checkPath(join(PROJECTS, "dotagents/agent-hooks/shared/core/path-guard.ts")).allowed).toBe(false);
  });

  // ── dotclaude → ~/.claude ─────────────────────────────────────────────
  test("allows writes through ~/.claude/", () => {
    expect(checkPath(HOME + "/.claude/scripts/some-file.ts").allowed).toBe(true);
  });

  test("blocks writes directly to dotclaude/", () => {
    expect(checkPath(join(PROJECTS, "dotclaude/some-file.ts")).allowed).toBe(false);
  });

  // ── outside Projects/ ─────────────────────────────────────────────────
  test("allows writes outside Projects/", () => {
    expect(checkPath("/tmp/test.txt").allowed).toBe(true);
    expect(checkPath(HOME + "/other/file.ts").allowed).toBe(true);
  });

  test("allows writes to non-dot repos under Projects/", () => {
    expect(checkPath(join(PROJECTS, "notadot/file.ts")).allowed).toBe(true);
  });

  // ── error message ─────────────────────────────────────────────────────
  test("error message shows the gateway path", () => {
    const r = checkPath(join(PROJECTS, "dotpi/docs/CONTEXT.md"));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("~/.pi/");
    expect(r.reason).toContain("dotpi/");
    expect(r.reason).toContain("docs/CONTEXT.md");
  });

  // ── non-existent files ────────────────────────────────────────────────
  test("blocks non-existent files inside dot* repos", () => {
    expect(checkPath(join(PROJECTS, "dotpi/new-folder/new-file.ts")).allowed).toBe(false);
  });

  test("allows non-existent files outside Projects/", () => {
    expect(checkPath("/tmp/new-folder/new-file.ts").allowed).toBe(true);
  });
});
