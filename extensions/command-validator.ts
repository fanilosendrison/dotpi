/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-hooks/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { CommandValidator } from "../../../.agents/agent-hooks/command-validator/src/core/validator";

const DESTRUCTIVE_PATTERNS = [
  />\s*\/dev\/(sda|hda|nvme)/i,
  /dd\s+.*of=\/dev\//i,
  /shred\s+.*\/dev\//i,
  /mkfs\.\w+\s+\/dev\//i,
  /rm\s+.*-rf\s*\/\s*$/i,
  /rm\s+.*-rf\s*\/etc/i,
  /rm\s+.*-rf\s*\/usr/i,
  /rm\s+.*-rf\s*\/bin/i,
  /rm\s+.*-rf\s*\/sys/i,
  /rm\s+.*-rf\s*\/home\/[^/]*\s*$/i,
  /fork\s+bomb|:\(\)\s*\{/i,
  /curl\s+.*\|\s*(sh|bash)/i,
  /wget\s+.*\|\s*(sh|bash)/i,
  /cat\s+\/etc\/(passwd|shadow)/i,
  />\s*\/etc\/(passwd|shadow)/i,
  /nc\s+.*-l.*-e/i,
  /nc\s+.*-e.*-l/i,
];

const DANGEROUS_ASK = ["sudo", "su", "passwd", "chmod", "chown", "kill",
  "systemctl", "mount", "nc", "nmap", "iptables"];

function isDangerousForAsk(cmd: string): string | null {
  const parts = cmd.trim().toLowerCase().split(/\s+/);
  const main = parts[0].split("/").pop() || "";
  if (DANGEROUS_ASK.includes(main)) return main;
  return null;
}

export default function (pi: ExtensionAPI) {
  const validator = new CommandValidator();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command;

    // Allow chmod +x (making scripts executable)
    if (/^chmod\s+\+x\s+/.test(cmd.trim())) return;

    // Use the shared validator for rm -rf and dangerous command detection
    const result = validator.validate(cmd);
    if (result.action === "deny") {
      return { block: true, reason: result.violations.join("; ") };
    }

    // Additional destructive patterns not in the shared validator
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(cmd)) {
        return { block: true, reason: `Destructive command blocked: ${cmd.slice(0, 80)}` };
      }
    }

    // Ask confirmation for dangerous-but-not-blocked commands
    const dangerous = isDangerousForAsk(cmd);
    if (dangerous || result.action === "ask") {
      const ok = await ctx.ui.confirm(
        "Dangerous command",
        `Allow: ${cmd.slice(0, 100)}`
      );
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });
}
