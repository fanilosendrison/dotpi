import { describe, expect, test } from "bun:test";
import { CommandValidator } from "../../../dotagents/agent-hooks/command-validator/src/core/validator";

const validator = new CommandValidator();

describe("CommandValidator", () => {
  // ── allow ──────────────────────────────────────────────────────────────
  test("allows safe commands", () => {
    const safeCmds = [
      "ls -la",
      "git status",
      "npm install",
      "bun test",
      "echo hello",
      "cat file.txt",
      "find . -name '*.ts'",
      "mkdir /tmp/test",
    ];
    for (const cmd of safeCmds) {
      expect(validator.validate(cmd).action).toBe("allow");
    }
  });

  test("allows chmod +x", () => {
    expect(validator.validate("chmod +x script.sh").action).toBe("allow");
    expect(validator.validate("chmod +x ./bin/tool").action).toBe("allow");
  });

  test("allows invalid/non-string input", () => {
    expect(validator.validate(null).action).toBe("deny");
    expect(validator.validate(undefined).action).toBe("deny");
    expect(validator.validate(42).action).toBe("deny");
    expect(validator.validate("").action).toBe("deny");
  });

  // ── deny (rm -rf) ──────────────────────────────────────────────────────
  test("denies rm -rf variants", () => {
    const blocked = [
      "rm -rf /",
      "rm -rf /etc",
      "rm -r -f /tmp/stuff",
      "rm -f -r /tmp/stuff",
      "rm -rf /usr",
      "rm -rf /home/user",
      "rm -rf ../..",
      "rm -rf $HOME",
      "rm -rf *",
    ];
    for (const cmd of blocked) {
      expect(validator.containsRmRf(cmd)).toBe(true);
    }
  });

  test("long flags like --recursive --force are NOT caught by containsRmRf", () => {
    // containsRmRf only matches short flags (-rf, -fr, etc.), not --recursive --force
    // The Pi extension's DESTRUCTIVE_PATTERNS cover these cases separately
    expect(validator.containsRmRf("rm --recursive --force /tmp/x")).toBe(false);
  });

  test("denies command with rm -rf verified by validate", () => {
    const result = validator.validate("rm -rf /tmp/stuff");
    expect(result.action).toBe("deny");
    expect(result.severity).toBe("CRITICAL");
    expect(result.violations).toContain("rm -rf is forbidden - use trash instead");
  });

  // ── ask (dangerous) ────────────────────────────────────────────────────
  test("asks for dangerous commands (shared validator: CRITICAL + PRIVILEGE + SYSTEM)", () => {
    const dangerous = [
      "sudo ls",
      "su -",
      "passwd user",
      "chmod 755 file",
      "chown user file",
      "kill 1234",
      "systemctl restart nginx",
      "mount /dev/sda1 /mnt",
      "dd if=/dev/zero of=test bs=1M count=10",
      "shred file.txt",
      "mkfs.ext4 /dev/sdb1",
    ];
    for (const cmd of dangerous) {
      const result = validator.validate(cmd);
      expect(result.action).toBe("ask");
      expect(result.severity).toBe("HIGH");
    }
  });

  test("network commands (nc, nmap, iptables) are NOT flagged by shared validator", () => {
    // NETWORK_COMMANDS are not in DANGEROUS_COMMANDS in the shared validator.
    // The Pi extension catches them separately via isDangerousForAsk().
    expect(validator.validate("nc -l 8080").action).toBe("allow");
    expect(validator.validate("nmap localhost").action).toBe("allow");
    expect(validator.validate("iptables -L").action).toBe("allow");
  });

  test("detects dangerous command in pipeline", () => {
    const results = [
      validator.validate("echo ok; sudo ls"),
      validator.validate("true && kill 1234"),
    ];
    for (const r of results) {
      expect(r.action).toBe("ask");
    }
  });

  // ── containsRmRf edge cases ─────────────────────────────────────────────
  test("containsRmRf false positives", () => {
    expect(validator.containsRmRf("git rm file.txt")).toBe(false);
    expect(validator.containsRmRf("npm rm package")).toBe(false);
    expect(validator.containsRmRf("echo 'rm -rf is bad'")).toBe(true); // pattern \brm matches the 'rm' inside quotes
  });

  // ── containsDangerousCommand ────────────────────────────────────────────
  test("containsDangerousCommand returns null for safe", () => {
    expect(validator.containsDangerousCommand("ls -la")).toBeNull();
    expect(validator.containsDangerousCommand("git status")).toBeNull();
    expect(validator.containsDangerousCommand("bun run test")).toBeNull();
  });

  test("containsDangerousCommand returns command name", () => {
    expect(validator.containsDangerousCommand("sudo rm file")).toBe("sudo");
    expect(validator.containsDangerousCommand("kill -9 123")).toBe("kill");
  });
});
