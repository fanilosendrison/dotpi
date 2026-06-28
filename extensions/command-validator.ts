/**
 * Pi extension — validates bash commands against security rules.
 *
 * Blocks destructive commands (rm -rf /, dd, format, etc.), redirects
 * dangerous ones (sudo, chmod, kill) with a user confirmation, and allows
 * safe commands through silently.
 *
 * Logic mirrors ~/.agents/agent-hooks/command-validator/src/core/validator.ts
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const CRITICAL = [
  "del", "format", "mkfs", "shred", "dd", "fdisk", "parted", "cfdisk",
];

const PRIVILEGE = [
  "sudo", "su", "passwd", "chpasswd", "usermod", "chmod", "chown", "chgrp",
];

const NETWORK = [
  "nc", "netcat", "nmap", "telnet", "iptables", "ufw", "firewall-cmd",
];

const SYSTEM = [
  "systemctl", "service", "kill", "killall", "pkill", "mount", "umount",
  "swapon", "swapoff",
];

const DANGEROUS = [...CRITICAL, ...PRIVILEGE, ...NETWORK, ...SYSTEM];

const RM_RF = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s/i,
  /\brm\s+-r\s+-f\s/i,
  /\brm\s+-f\s+-r\s/i,
];

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

function containsDangerousCmd(command: string): string | null {
  const normalized = command.trim().toLowerCase();
  const parts = normalized.split(/\s+/);
  const main = parts[0].split("/").pop() || "";

  if (DANGEROUS.includes(main)) return main;

  for (const d of DANGEROUS) {
    const pattern = new RegExp(`(?:^|[;|&\\n]|\\$\\(|\\`)\\s*${d}\\b`, "i");
    if (pattern.test(command)) return d;
  }

  return null;
}

function containsRmRf(command: string): boolean {
  return RM_RF.some((r) => r.test(command));
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command;

    // Allow chmod +x (making scripts executable)
    if (/^chmod\s+\+x\s+/.test(cmd.trim())) return;

    // Block rm -rf unconditionally
    if (containsRmRf(cmd)) {
      return { block: true, reason: "rm -rf is forbidden — use trash or remove files individually" };
    }

    // Block destructive patterns
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(cmd)) {
        return { block: true, reason: `Destructive command blocked: ${cmd.slice(0, 80)}` };
      }
    }

    // Ask confirmation for dangerous commands
    const dangerous = containsDangerousCmd(cmd);
    if (dangerous) {
      const ok = await ctx.ui.confirm(
        "Dangerous command",
        `Allow: ${cmd.slice(0, 100)}`
      );
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });
}
