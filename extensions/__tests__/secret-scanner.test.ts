import { describe, expect, test } from "bun:test";
import { scanDiff } from "../../../dotagents/agent-enforcers/secret-scanner/src/core/scanner";

describe("secret-scanner / scanDiff", () => {
  // ── clean diffs ────────────────────────────────────────────────────────
  test("empty diff is clean", () => {
    expect(scanDiff("").clean).toBe(true);
    expect(scanDiff("   \n  ").clean).toBe(true);
  });

  test("diff without additions is clean", () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-old line
+new line without secrets`;
    expect(scanDiff(diff).clean).toBe(true);
  });

  test("normal code additions are clean", () => {
    const diff = `+const x = 1;
+function hello() {
+  return "world";
+}`;
    expect(scanDiff(diff).clean).toBe(true);
  });

  // ── secrets detected ───────────────────────────────────────────────────
  test("detects AWS access key", () => {
    const diff = "+AKIAIOSFODNN7EXAMPLE";
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.name === "AWS Access Key")).toBe(true);
  });

  test("detects GitHub token", () => {
    const diff = "+ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.name === "GitHub Token")).toBe(true);
  });

  test("detects private key block", () => {
    const diff = "+-----BEGIN PRIVATE KEY-----";
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.name === "Private Key")).toBe(true);
  });

  test("detects env-like secrets (may match Generic API Key first)", () => {
    // OPENAI_API_KEY matches Generic API Key pattern (api_key) before Env Secret
    const diff = "+OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz";
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    // It matches either Generic API Key or Env Secret depending on pattern order
    expect(r.findings.length).toBeGreaterThanOrEqual(1);
  });

  test("detects env secrets specifically (SECRET_KEY, STRIPE_API_KEY, etc.)", () => {
    // These don't overlap with Generic API Key pattern
    expect(scanDiff("+SECRET_KEY=super_secret_key_123456789").clean).toBe(false);
    expect(scanDiff("+STRIPE_API_KEY=sk_live_abcdefghijklmnop").clean).toBe(false);
  });

  test("detects connection strings with credentials", () => {
    const diff = "+mongodb://user:password@localhost:27017/db";
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.name === "Connection String")).toBe(true);
  });

  test("detects generic API key", () => {
    const diff = '+api_key: "abcdefghijklmnopqrstuvwxyz123456"';
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.name === "Generic API Key")).toBe(true);
  });

  // ── false positives ────────────────────────────────────────────────────
  test("ignores additions with env var references", () => {
    const clean = [
      "+const key = process.env.API_KEY;",
      "+const secret = os.environ['SECRET'];",
      "+const token = `${API_TOKEN}`;",
      "+const pw = getenv('DB_PASS');",
      "+const key = requireEnv('MY_KEY');",
      "+const api = getApiKey();",
    ];
    for (const line of clean) {
      const r = scanDiff(line);
      expect(r.clean).toBe(true);
    }
  });

  test("ignores placeholder passwords", () => {
    const placeholders = [
      "+password=changeme",
      "+password=password",
      "+password=placeholder",
      "+password=example",
      "+password=xxx",
      "+password=xxxxxxxx",
      "+password=todo",
      "+password=fixme",
    ];
    for (const line of placeholders) {
      const r = scanDiff(line);
      expect(r.clean).toBe(true);
    }
  });

  test("ignores short password-like values", () => {
    // Password pattern fires but confirm rejects because value < 8 chars
    expect(scanDiff("+password=abc").clean).toBe(true);
    expect(scanDiff("+password=1234567").clean).toBe(true);
  });

  test("detects real-looking password assignments", () => {
    expect(scanDiff("+password=MyS3cur3P@ssw0rd!").clean).toBe(false);
    expect(scanDiff("+DB_PASSWORD=super_secret_12345").clean).toBe(false);
  });

  // ── Slack token ────────────────────────────────────────────────────────
  test("detects Slack tokens", () => {
    expect(scanDiff("+xoxb-1234567890-abcdefghijklmnop").clean).toBe(false);
  });

  // ── line number tracking ───────────────────────────────────────────────
  test("tracks line numbers", () => {
    const diff = ` line 1
+AKIAIOSFODNN7EXAMPLE
 line 3`;
    const r = scanDiff(diff);
    expect(r.findings[0].lineNumber).toBe(2);
  });

  // ── multiple findings ──────────────────────────────────────────────────
  test("reports multiple secrets in one diff", () => {
    const diff = `+AKIAIOSFODNN7EXAMPLE
+OPENAI_API_KEY=sk-abcdefghijklmnop`;
    const r = scanDiff(diff);
    expect(r.clean).toBe(false);
    expect(r.findings.length).toBe(2);
  });
});
