/**
 * Pi extension — blocks git commits containing secrets, API keys, or tokens.
 *
 * Scans the staged diff before every `git commit` command. The detection
 * logic mirrors `~/.agents/agent-hooks/secret-scanner/src/core/scanner.ts`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { $ } from "bun";

const PASSWORD_PLACEHOLDERS = [
  "changeme", "password", "placeholder", "example",
  "xxx", "xxxxxxxx", "todo", "fixme",
];

function extractAssignedValue(content: string): string {
  const match = content.match(/[:=]\s*['"]?(.*?)['"]?\s*$/);
  return match ? match[1].replace(/^['"]|['"]$/g, "") : "";
}

interface SecretPattern {
  name: string;
  pattern: RegExp;
  confirm?: (content: string) => boolean;
}

const PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS Secret Key", pattern: /(?:aws_secret_access_key|aws_secret_key)\s*=\s*\S{20,}/i },
  { name: "Private Key", pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: "Slack Token", pattern: /xox[baprs]-[0-9]{10,}-[a-zA-Z0-9-]+/ },
  { name: "Connection String", pattern: /(?:mongodb|postgres|postgresql|mysql|redis):\/\/[^\s:]+:[^\s@]+@[^\s]+/ },
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?\S{20,}/i },
  { name: "Generic Token", pattern: /(?:auth_token|access_token|refresh_token)\s*[:=]\s*['"]?\S{20,}/i },
  { name: "Env Secret", pattern: /(?:SECRET_KEY|PRIVATE_KEY|STRIPE_API_KEY|STRIPE_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|SENDGRID_API_KEY)\s*=\s*\S{16,}/ },
  {
    name: "Password / Secret",
    pattern: /(?:password|passwd|pwd|DB_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD)\s*=\s*/i,
    confirm: (content: string) => {
      const value = extractAssignedValue(content);
      if (value.length < 8) return false;
      return !PASSWORD_PLACEHOLDERS.includes(value.toLowerCase());
    },
  },
];

const FALSE_POSITIVES = [
  /process\.env[\.\[]\w+/,
  /os\.environ\[/,
  /\$\{?\w+\}?/,
  /getenv\(/,
  /requireEnv\(/,
  /getApiKey\(/,
];

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command;
    if (!/\bgit\s+commit\b/.test(cmd)) return;

    // Get the staged diff
    let diff: string;
    try {
      diff = await $`git diff --cached`.text();
    } catch {
      return; // no staged changes, nothing to scan
    }

    if (!diff.trim()) return;

    const findings: string[] = [];
    for (const line of diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      const content = line.slice(1);
      if (FALSE_POSITIVES.some((p) => p.test(content))) continue;

      for (const { name, pattern, confirm } of PATTERNS) {
        if (pattern.test(content)) {
          if (confirm && !confirm(content)) continue;
          findings.push(`${name}: ${content.trim().slice(0, 80)}`);
          break;
        }
      }
    }

    if (findings.length > 0) {
      return {
        block: true,
        reason: `Secret(s) detected in staged diff:\n${findings.join("\n")}`,
      };
    }
  });
}
