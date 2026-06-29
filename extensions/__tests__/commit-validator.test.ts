import { describe, expect, test } from "bun:test";
import {
  isGitCommit,
  extractCommitMessage,
  validateCommitMessage,
} from "../../../dotagents/agent-enforcers/commit-msg-validator/src/core/validator";

describe("commit-validator", () => {
  // ── isGitCommit ────────────────────────────────────────────────────────
  test("detects git commit commands", () => {
    expect(isGitCommit("git commit -m 'msg'")).toBe(true);
    expect(isGitCommit("git commit -am 'msg'")).toBe(true);
    expect(isGitCommit(" git  commit  -m test")).toBe(true);
    expect(isGitCommit("echo git commit")).toBe(true); // regex matches any occurrence of "git commit"
    expect(isGitCommit("git push")).toBe(false);
    expect(isGitCommit("")).toBe(false);
  });

  // ── extractCommitMessage ───────────────────────────────────────────────
  test("extracts double-quoted message", () => {
    expect(extractCommitMessage('git commit -m "feat(api): add endpoint"'))
      .toBe("feat(api): add endpoint");
  });

  test("extracts single-quoted message", () => {
    expect(extractCommitMessage("git commit -m 'fix(ui): repair button'"))
      .toBe("fix(ui): repair button");
  });

  test("extracts heredoc message", () => {
    const cmd = `git commit -m <<'EOF'
feat(core): new feature
more details
EOF`;
    expect(extractCommitMessage(cmd)).toBe("feat(core): new feature");
  });

  test("returns null when no -m flag", () => {
    expect(extractCommitMessage("git commit")).toBeNull();
    expect(extractCommitMessage("ls -la")).toBeNull();
  });

  test("returns null for empty strings", () => {
    expect(extractCommitMessage("")).toBeNull();
    expect(extractCommitMessage('git commit -m ""')).toBeNull();
  });

  // ── validateCommitMessage ──────────────────────────────────────────────
  test("accepts valid Conventional Commits messages", () => {
    const valid = [
      "feat(api): add new endpoint",
      "fix(ui): repair broken button",
      "docs(readme): update installation section",
      "style: format with prettier",
      "refactor(core): extract helper function",
      "perf(db): optimize query index",
      "test(auth): add login unit tests",
      "build: update webpack config",
      "ci: add github actions workflow",
      "chore(deps): bump lodash to 4.17.21",
      "revert: rollback last change",
      "feat!: breaking change notification",
      "feat(scope)!: breaking with scope",
    ];
    for (const msg of valid) {
      const r = validateCommitMessage(msg);
      expect(r.valid).toBe(true);
    }
  });

  test("rejects empty message", () => {
    const r = validateCommitMessage("");
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("Message de commit vide");
  });

  test("rejects invalid format", () => {
    const r = validateCommitMessage("just a message without type");
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("Format invalide");
  });

  test("rejects invalid type", () => {
    const r = validateCommitMessage("wip: something");
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("Type"))).toBe(true);
  });

  test("rejects uppercase start in description", () => {
    const r = validateCommitMessage("feat: Hello world");
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("majuscule"))).toBe(true);
  });

  test("rejects trailing dot in description", () => {
    const r = validateCommitMessage("feat(api): add endpoint.");
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("point"))).toBe(true);
  });

  test("rejects subject over 72 chars", () => {
    const long = "feat(api): " + "add a very long description that exceeds the seventy two character limit by far";
    const r = validateCommitMessage(long);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("72"))).toBe(true);
  });

  test("rejects past tense", () => {
    const r = validateCommitMessage("feat(api): added endpoint");
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("passé"))).toBe(true);
  });

  test("rejects gerund form", () => {
    const r = validateCommitMessage("feat(api): adding endpoint");
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("gérondif"))).toBe(true);
  });

  test("rejects vague descriptions", () => {
    const vague = ["fix bug", "updates", "wip", "stuff", "changes", "misc"];
    for (const msg of vague) {
      const r = validateCommitMessage(`feat: ${msg}`);
      expect(r.valid).toBe(false);
      expect(r.errors.some(e => e.includes("vague"))).toBe(true);
    }
  });

  test("accumulates multiple errors", () => {
    const r = validateCommitMessage("WIP: Fixed stuff.");
    expect(r.valid).toBe(false);
    // Should have at least: format, type, uppercase, past tense, trailing dot, vague
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});
