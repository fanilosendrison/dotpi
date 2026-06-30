import { describe, expect, test } from "bun:test";
import {
  checkPath,
  extractBashPaths,
  checkBashCommand,
  rewriteBashCommand,
} from "../../../dotagents/agent-enforcers/path-guard/src/core/path-guard";
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
    const res1 = checkPath(join(PROJECTS, "dotpi/extensions/command-validator.ts"));
    expect(res1.allowed).toBe(false);
    expect(res1.rewrittenPath).toBe(HOME + "/.pi/agent/extensions/command-validator.ts");

    const res2 = checkPath(join(PROJECTS, "dotpi/CONTEXT.md"));
    expect(res2.allowed).toBe(false);
    expect(res2.rewrittenPath).toBe(HOME + "/.pi/agent/CONTEXT.md");
  });

  // ── dotagents → ~/.agents ─────────────────────────────────────────────
  test("allows writes through ~/.agents/", () => {
    expect(checkPath(HOME + "/.agents/agent-enforcers/shared/core/path-guard.ts").allowed).toBe(true);
  });

  test("blocks writes directly to dotagents/", () => {
    const res = checkPath(join(PROJECTS, "dotagents/agent-enforcers/shared/core/path-guard.ts"));
    expect(res.allowed).toBe(false);
    expect(res.rewrittenPath).toBe(HOME + "/.agents/agent-enforcers/shared/core/path-guard.ts");
  });

  // ── dotclaude → ~/.claude ─────────────────────────────────────────────
  test("allows writes through ~/.claude/", () => {
    expect(checkPath(HOME + "/.claude/scripts/some-file.ts").allowed).toBe(true);
  });

  test("blocks writes directly to dotclaude/", () => {
    const res = checkPath(join(PROJECTS, "dotclaude/some-file.ts"));
    expect(res.allowed).toBe(false);
    expect(res.rewrittenPath).toBe(HOME + "/.claude/some-file.ts");
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
    expect(r.rewrittenPath).toBe(HOME + "/.pi/agent/docs/CONTEXT.md");
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

  // ── relative paths (regression: previously allowed bypass via cd) ──
  test("extracts relative paths containing /", () => {
    const paths = extractBashPaths(
      `mkdir -p ../../Developper/Projects/dotpi/.pi`,
    );
    expect(paths).toContain("../../Developper/Projects/dotpi/.pi");
  });

  test("extracts relative redirect targets", () => {
    const paths = extractBashPaths(
      `echo hi > ../../../dotpi/out.txt`,
    );
    expect(paths).toContain("../../../dotpi/out.txt");
  });

  test("extracts relative tee targets", () => {
    const paths = extractBashPaths(
      `echo hi | tee ../dotpi/log.txt`,
    );
    expect(paths).toContain("../dotpi/log.txt");
  });

  test("extracts ./ paths", () => {
    const paths = extractBashPaths(
      `cat ./some/file.txt`,
    );
    expect(paths).toContain("./some/file.txt");
  });

  test("skips flags even when they contain /", () => {
    // --foo/bar is a flag, not a path
    const paths = extractBashPaths(
      `somecmd --foo/bar /real/path`,
    );
    expect(paths).not.toContain("--foo/bar");
    expect(paths).toContain("/real/path");
  });
});

describe("path-guard / rewriteBashCommand", () => {
  test("returns unmodified safe bash commands", () => {
    expect(rewriteBashCommand("ls -la").rewritten).toBe(false);
    expect(rewriteBashCommand("ls -la").newCommand).toBe("ls -la");
    expect(rewriteBashCommand("echo hello").rewritten).toBe(false);
    expect(rewriteBashCommand("git status").rewritten).toBe(false);
  });

  test("rewrites redirect to dotpi/", () => {
    const r = rewriteBashCommand(
      `echo hi > ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`echo hi > ${HOME}/.pi/agent/file.ts`);
    expect(r.newCommand).toContain("echo -e"); // The verbose warning
    expect(r.newCommand).toContain("[Path-Guard]");
  });

  test("rewrites tee to dotpi/", () => {
    const r = rewriteBashCommand(
      `echo hi | tee ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`echo hi | tee ${HOME}/.pi/agent/file.ts`);
  });

  test("rewrites cp to dotpi/", () => {
    const r = rewriteBashCommand(
      `cp /tmp/a ${PROJECTS}/dotpi/file.ts`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`cp /tmp/a ${HOME}/.pi/agent/file.ts`);
  });

  test("allows writes through ~/.pi/ in bash (expanded)", () => {
    const r = rewriteBashCommand(
      `echo hi > ${HOME}/.pi/agent/test.txt`,
    );
    expect(r.rewritten).toBe(false);
    expect(r.newCommand).toBe(`echo hi > ${HOME}/.pi/agent/test.txt`);
  });

  test("allows writes through ~/.pi/ in bash (tilde form)", () => {
    const r = rewriteBashCommand(
      `echo hi > ~/.pi/agent/test.txt`,
    );
    expect(r.rewritten).toBe(false);
  });

  test("rewrites redirect to dotagents/", () => {
    const r = rewriteBashCommand(
      `echo hi > ${PROJECTS}/dotagents/test.txt`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`${HOME}/.agents/test.txt`);
  });

  // ── tilde expansion ─────────────────────────
  test("does not infinite-loop and rewrites ls ~/Developper/Projects/dotpi", () => {
    const r = rewriteBashCommand("ls ~/Developper/Projects/dotpi");
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`ls ${HOME}/.pi/agent`);
  });

  test("rewrites cp to ~/Developper/Projects/dotpi", () => {
    const r = rewriteBashCommand(`cp /tmp/a ~/Developper/Projects/dotpi/file.ts`);
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`${HOME}/.pi/agent/file.ts`);
  });

  // ── unwrapCommand regression ─────────────────
  test("rewrites env -i /bin/bash -c with dotpi redirect inside", () => {
    const oldCwd = process.cwd();
    try {
      // Run in a neutral directory so specs/file.md isn't accidentally resolved as inside dotpi
      process.chdir(HOME);
      const r = rewriteBashCommand(
        `env -i HOME=$HOME PATH=$PATH /bin/bash -c 'cd ${PROJECTS}/dotpi && echo hi > specs/file.md'`,
      );
      expect(r.rewritten).toBe(true);
      expect(r.newCommand).toContain(`cd ${HOME}/.pi/agent && echo hi > specs/file.md`);
    } finally {
      process.chdir(oldCwd);
    }
  });

  test("rewrites env -i bash -c with dotpi path in double quotes", () => {
    const r = rewriteBashCommand(
      `env -i bash -c "echo hi > ${PROJECTS}/dotpi/file.ts"`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`${HOME}/.pi/agent/file.ts`);
  });

  // ── git whitelist ────────────────────────────────
  test("allows pure git operations on dotpi", () => {
    expect(
      rewriteBashCommand(`cd ${PROJECTS}/dotpi && git status`).rewritten,
    ).toBe(false);
    expect(
      rewriteBashCommand(
        `cd ${PROJECTS}/dotpi && git add . && git commit -m "test" && git push`,
      ).rewritten,
    ).toBe(false);
  });

  test("rewrites mixed git and non-git commands", () => {
    const r = rewriteBashCommand(
      `cd ${PROJECTS}/dotpi && git status && echo hi > ${PROJECTS}/dotpi/out.txt`,
    );
    expect(r.rewritten).toBe(true);
    expect(r.newCommand).toContain(`${HOME}/.pi/agent/out.txt`);
  });

  test("allows git operations with trailing shell status helpers", () => {
    const oldCwd = process.cwd();
    try {
      // Must be run in a directory that has the target relative path so resolveReal finds it
      process.chdir(join(PROJECTS, "dotagents"));
      const r = rewriteBashCommand(
        `git add -- agent-enforcers/path-guard/src/core/path-guard.ts 2>&1; echo "exit:$?"`,
      );
      expect(r.rewritten).toBe(false);
    } finally {
      process.chdir(oldCwd);
    }

    expect(
      rewriteBashCommand(
        `git commit -m "docs: clean" && echo "done"`,
      ).rewritten,
    ).toBe(false);
  });

  // ── relative path bypass (regression) ────────────────────────────────
  test("rewrites relative mkdir into dotpi", () => {
    const oldCwd = process.cwd();
    try {
      process.chdir(HOME + "/.pi/agent");
      const r = rewriteBashCommand(
        `cd ~/.pi/agent && mkdir -p ../../Developper/Projects/dotpi/.pi`,
      );
      expect(r.rewritten).toBe(true);
      expect(r.newCommand).toContain(`${HOME}/.pi/agent/.pi`);
    } finally {
      process.chdir(oldCwd);
    }
  });

  test("rewrites relative redirect into dotpi", () => {
    const oldCwd = process.cwd();
    try {
      process.chdir(HOME + "/.pi/agent");
      const r = rewriteBashCommand(
        `echo hi > ../../Developper/Projects/dotpi/file.ts`,
      );
      expect(r.rewritten).toBe(true);
      expect(r.newCommand).toContain(`${HOME}/.pi/agent/file.ts`);
    } finally {
      process.chdir(oldCwd);
    }
  });
});
