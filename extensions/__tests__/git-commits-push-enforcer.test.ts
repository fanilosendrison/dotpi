import { describe, expect, test } from "bun:test";
import {
  isGitCommit,
  extractMessage,
  isValidCC,
  hasPush,
} from "../../../dotagents/agent-hooks/git-commits-push-enforcer/src/core/validator";

describe("git-commits-push-enforcer", () => {
  // ── isGitCommit ────────────────────────────────────────────────────────
  test("detects git commit", () => {
    expect(isGitCommit("git commit -m 'msg'")).toBe(true);
    expect(isGitCommit("git commit -am 'msg' && git push")).toBe(true);
    expect(isGitCommit("git status")).toBe(false);
    expect(isGitCommit("git push")).toBe(false);
    expect(isGitCommit("")).toBe(false);
  });

  // ── extractMessage ─────────────────────────────────────────────────────
  test("extracts from double quotes", () => {
    expect(extractMessage('git commit -m "feat: ok"'))
      .toBe("feat: ok");
  });

  test("extracts from single quotes", () => {
    expect(extractMessage("git commit -m 'fix: done'"))
      .toBe("fix: done");
  });

  test("extracts from heredoc", () => {
    const cmd = `git commit -m <<'EOF'
feat: heredoc commit
body
EOF`;
    expect(extractMessage(cmd)).toBe("feat: heredoc commit");
  });

  test("returns null when no -m", () => {
    expect(extractMessage("git commit")).toBeNull();
    expect(extractMessage("git commit -a")).toBeNull();
    expect(extractMessage("echo hello")).toBeNull();
  });

  // ── isValidCC ──────────────────────────────────────────────────────────
  test("accepts valid CC messages", () => {
    expect(isValidCC("feat(api): add endpoint")).toBe(true);
    expect(isValidCC("fix: repair bug")).toBe(true);
    expect(isValidCC("feat!: breaking change")).toBe(true);
    expect(isValidCC("chore(deps): bump version")).toBe(true);
  });

  test("rejects invalid CC messages", () => {
    expect(isValidCC("wip")).toBe(false);
    expect(isValidCC("fixed a bug")).toBe(false);
    expect(isValidCC("feat add feature")).toBe(false); // missing colon
    expect(isValidCC(": missing type")).toBe(false);
    expect(isValidCC("")).toBe(false);
  });

  // ── hasPush ────────────────────────────────────────────────────────────
  test("detects git push", () => {
    expect(hasPush("git commit -m 'msg' && git push")).toBe(true);
    expect(hasPush("git push origin main")).toBe(true);
    expect(hasPush("git commit -m 'msg'")).toBe(false);
    expect(hasPush("echo git push")).toBe(true); // regex matches any occurrence of "git push"
    expect(hasPush("")).toBe(false);
  });

  test("combined scenarios", () => {
    // CC valid + push → allowed
    const cmd = 'git commit -m "feat: ok" && git push';
    const msg = extractMessage(cmd);
    expect(msg).toBe("feat: ok");
    expect(isValidCC(msg!)).toBe(true);
    expect(hasPush(cmd)).toBe(true);

    // CC valid, no push → blocked
    const cmd2 = 'git commit -m "feat: ok"';
    expect(hasPush(cmd2)).toBe(false);

    // CC invalid, push present → blocked
    const cmd3 = 'git commit -m "wip" && git push';
    const msg3 = extractMessage(cmd3);
    expect(isValidCC(msg3!)).toBe(false);
    expect(hasPush(cmd3)).toBe(true);
  });
});
