/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 *
 * Stats logging: counts denies and ask_confirm outcomes per session/model
 * in ~/neelopedia/stats/pi/command-validator/events.jsonl.
 */
import crypto from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const VALIDATOR_PATH = join(
	homedir(),
	".agents/agent-enforcers/command-validator/src/core/validator",
);
const { CommandValidator } = require(VALIDATOR_PATH);

import { createStatsLog } from "./command-validator-internals/stats-log";

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

const DANGEROUS_ASK = [
	"sudo",
	"su",
	"passwd",
	"chmod",
	"chown",
	"kill",
	"systemctl",
	"mount",
	"nc",
	"nmap",
	"iptables",
];

function isDangerousForAsk(cmd: string): string | null {
	const parts = cmd.trim().toLowerCase().split(/\s+/);
	const main = parts[0].split("/").pop() || "";
	if (DANGEROUS_ASK.includes(main)) return main;
	return null;
}

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	const statsDir = join(
		homedir(),
		"neelopedia",
		"stats",
		"pi",
		"command-validator",
	);
	let lastModel: string | undefined;

	const statsLog = createStatsLog({
		statsDir,
		sessionId,
		cwd: process.cwd(),
	});

	const validator = new CommandValidator();

	// ── Capture model from provider requests ─────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;

		// Increment total counter (called for every bash command)
		statsLog.incTotal();

		// Allow chmod +x (making scripts executable)
		if (/^chmod\s+\+x\s+/.test(cmd.trim())) return;

		// Use the shared validator for rm -rf and dangerous command detection
		const result = validator.validate(cmd);
		if (result.action === "deny") {
			statsLog.addDeny({
				ts: new Date().toISOString(),
				severity: result.severity,
				violations: result.violations,
				command: cmd,
			});
			return { block: true, reason: result.violations.join("; ") };
		}

		// Additional destructive patterns not in the shared validator
		for (const pattern of DESTRUCTIVE_PATTERNS) {
			if (pattern.test(cmd)) {
				statsLog.addDeny({
					ts: new Date().toISOString(),
					severity: "CRITICAL",
					violations: ["Destructive pattern"],
					command: cmd,
				});
				return {
					block: true,
					reason: `Destructive command blocked: ${cmd.slice(0, 80)}`,
				};
			}
		}

		// Ask confirmation for dangerous-but-not-blocked commands
		const dangerous = isDangerousForAsk(cmd);
		if (dangerous || result.action === "ask") {
			const ok = await ctx.ui.confirm(
				"Dangerous command",
				`Allow: ${cmd.slice(0, 100)}`,
			);
			statsLog.addAskConfirm({
				ts: new Date().toISOString(),
				tool: dangerous || "unknown",
				severity: "HIGH",
				outcome: ok ? "allowed" : "denied",
				command: cmd,
			});
			if (!ok) {
				return { block: true, reason: "Blocked by user" };
			}
		}
	});

	// ── Flush session summary once at session end ───────────────────────────

	pi.on("session_shutdown", () => {
		statsLog.flushSummary({
			endTs: new Date().toISOString(),
			model: lastModel,
			totalTurns: 0,
		});
	});
}
