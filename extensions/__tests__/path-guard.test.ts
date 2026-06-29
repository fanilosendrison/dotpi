import { describe, expect, test } from "bun:test";
import {
  checkPath,
  extractBashPaths,
  checkBashCommand,
} from "../../../dotagents/agent-hooks/path-guard/src/core/path-guard";
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

  test("error message shows git commit path", () => {
    const r = checkPath(join(PROJECTS, "dotpi/file.ts"));
    expect(r.reason).toContain("Git:");
    expect(r.reason).toContain("cd ~/Developper/Projects/dotpi/ && git commit");
  });

  // ── non-existent files ────────────────────────────────────────────────
  test("blocks non-existent files inside dot* repos", () => {
    expect(checkPath(join(PROJECTS, "dotpi/new-folder/new-file.ts")).allowed).toBe(false);
  });

  test("allows non-existent files outside Projects/", () => {
    expect(checkPath("/tmp/new-folder/new-file.ts").allowed).toBe(true);
  });

  // ── tilde expansion (regression: previously infinite-looped) ─────────
  test("does not infinite-loop on ~/ paths inside dot* repos", () => {
    // Before the fix, checkPath("~/Developper/Projects/dotpi/...") entered
    // an infinite loop inside resolveReal because the ancestor walk kept
    // producing `~` (no `/` to strip), and existsSync("~") always returned
    // false. The test would hang the suite indefinitely.
    expect(
      checkPath("~/Developper/Projects/dotpi/extensions/path-guard.ts").allowed,
    ).toBe(false);
  });

  test("does not infinite-loop on ~/ paths outside Projects/", () => {
    expect(checkPath("~/some/random/file.ts").allowed).toBe(true);
  });

  test("does not infinite-loop on bare ~", () => {
    expect(checkPath("~").allowed).toBe(true);
  });
});

describe("path-guard / extractBashPaths", () => {
  test("extracts absolute paths from command arguments", () => {
    const paths = extractBashPaths(
      `cp /tmp/a ${PROJECTS}/dotpi/file.ts`,
    );
    expect(paths).toContain("/tmp/a");
    expect(paths).toContain(`${PROJECTS}/dotpi/file.ts`);
  });

  test("extracts redirect targets", () => {
    const paths = extractBashPaths(
      `echo hello > ${PROJECTS}/dotpi/out.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/out.txt`);
  });

  test("extracts append redirect targets", () => {
    const paths = extractBashPaths(
      `echo hello >> ${PROJECTS}/dotpi/log.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/log.txt`);
  });

  test("extracts stderr redirect targets", () => {
    const paths = extractBashPaths(
      `cmd 2> ${PROJECTS}/dotpi/err.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/err.txt`);
  });

  test("extracts stdout+stderr redirect targets", () => {
    const paths = extractBashPaths(
      `cmd &> ${PROJECTS}/dotpi/all.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/all.txt`);
  });

  test("extracts tee targets", () => {
    const paths = extractBashPaths(
      `echo hi | tee ${PROJECTS}/dotpi/out.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/out.txt`);
  });

  test("extracts tee -a targets", () => {
    const paths = extractBashPaths(
      `echo hi | tee -a ${PROJECTS}/dotpi/out.txt`,
    );
    expect(paths).toContain(`${PROJECTS}/dotpi/out.txt`);
  });

  test("extracts ~/ paths", () => {
    const paths = extractBashPaths(
      `echo hi > ~/Developper/Projects/dotpi/file.ts`,
    );
    expect(paths).toContain("~/Developper/Projects/dotpi/file.ts");
  });

  test("ignores paths inside single quotes", () => {
    const paths = extractBashPaths(
      `echo 'redirect > ${PROJECTS}/dotpi/fake'`,
    );
    // The > inside quotes should not be treated as a redirect
    expect(paths).not.toContain(`${PROJECTS}/dotpi/fake`);
  });

  test("ignores paths inside double quotes", () => {
    const paths = extractBashPaths(
      `echo "redirect > ${PROJECTS}/dotpi/fake"`,
    );
    expect(paths).not.toContain(`${PROJECTS}/dotpi/fake`);
  });

  test("returns empty for safe commands", () => {
    const paths = extractBashPaths("ls -la");
    expect(paths).toEqual([]);
  });

  test("returns empty for echo without redirect", () => {
    const paths = extractBashPaths("echo hello world");
    expect(paths).toEqual([]);
  });

  test("deduplicates paths", () => {
    const paths = extractBashPaths(
      `${PROJECTS}/dotpi/a ${PROJECTS}/dotpi/a`,
    );
    expect(paths.filter((p) => p === `${PROJECTS}/dotpi/a`)).toHaveLength(1);
  });
});

describe("path-guard / checkBashCommand", () => {
  test("allows safe bash commands", () => {
    expect(checkBashCommand("ls -la").allowed).toBe(true);
    expect(checkBashCommand("echo hello").allowed).toBe(true);
    expect(checkBashCommand("git status").allowed).toBe(true);
  });

  test("blocks redirect to dotpi/", () => {
    const r = checkBashCommand(
      `echo hi > ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("~/.pi/");
  });

  test("blocks tee to dotpi/", () => {
    const r = checkBashCommand(
      `echo hi | tee ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.allowed).toBe(false);
  });

  test("blocks cp to dotpi/", () => {
    const r = checkBashCommand(
      `cp /tmp/a ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.allowed).toBe(false);
  });

  test("allows writes through ~/.pi/ in bash", () => {
    const r = checkBashCommand(
      `echo hi > ${HOME}/.pi/agent/test.txt`,
    );
    expect(r.allowed).toBe(true);
  });

  test("blocks redirect to dotagents/", () => {
    const r = checkBashCommand(
      `echo hi > ${PROJECTS}/dotagents/test.txt`,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("~/.agents/");
  });

  // ── tilde expansion (regression: previously infinite-looped) ─────────
  // Before the fix, `ls ~/Developper/Projects/dotpi` would hang the agent
  // because checkPath entered an infinite loop in resolveReal.
  test("does not infinite-loop on ls ~/Developper/Projects/dotpi", () => {
    expect(
      checkBashCommand("ls ~/Developper/Projects/dotpi").allowed,
    ).toBe(false);
  });

  test("does not infinite-loop on cp to ~/Developper/Projects/dotpi", () => {
    expect(
      checkBashCommand(`cp /tmp/a ~/Developper/Projects/dotpi/file.ts`).allowed,
    ).toBe(false);
  });

  // ── unwrapCommand regression: env -i bypass attempts ─────────────────
  test("blocks env -i /bin/bash -c with dotpi redirect inside", () => {
    const r = checkBashCommand(
      `env -i HOME=$HOME PATH=$PATH /bin/bash -c 'cd ${PROJECTS}/dotpi && echo hi > specs/file.md'`,
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("~/.pi/");
  });

  test("blocks env -i /usr/bin/bash -c with dotpi path inside", () => {
    const r = checkBashCommand(
      `env -i PATH=/usr/bin /usr/bin/bash -c 'echo hi > ${PROJECTS}/dotpi/test.txt'`,
    );
    expect(r.allowed).toBe(false);
  });

  test("blocks env -i sh -c with dotpi path inside (bare shell name)", () => {
    const r = checkBashCommand(
      `env -i sh -c 'git add ${PROJECTS}/dotpi/file.ts'`,
    );
    expect(r.allowed).toBe(false);
  });

  test("blocks env -i bash -c with dotpi path in double quotes", () => {
    const r = checkBashCommand(
      `env -i bash -c "echo hi > ${PROJECTS}/dotpi/file.ts"`,
    );
    expect(r.allowed).toBe(false);
  });

  test("blocks exec env -i bash -c with dotpi path inside", () => {
    const r = checkBashCommand(
      `exec env -i bash -c 'cd ${PROJECTS}/dotpi && git status'`,
    );
    expect(r.allowed).toBe(false);
  });

  test("blocks env -i $SHELL -c with dotpi path inside", () => {
    const r = checkBashCommand(
      `env -i $SHELL -c 'echo hi > ${PROJECTS}/dotpi/test.txt'`,
    );
    expect(r.allowed).toBe(false);
  });
});
