/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";

const VALIDATOR_PATH = join(
	homedir(),
	".agents/agent-enforcers/command-validator/src/core/validator",
);
const { CommandValidator } = require(VALIDATOR_PATH);

function readDefaultThinking(): string {
	try {
		const p = join(homedir(), ".pi", "agent", "settings.json");
		if (fs.existsSync(p)) {
			return (
				JSON.parse(fs.readFileSync(p, "utf-8")).defaultThinkingLevel ??
				"unknown"
			);
		}
	} catch {}
	return "unknown";
}

export default function (pi: ExtensionAPI) {
	const validator = new CommandValidator();

	// ── Telemetry Setup ────────────────────────────────────────────────────────

	const sessionId = crypto.randomUUID();
	let lastModel: string | undefined;
	let lastThinking: string = readDefaultThinking();

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
	});

	const sink = createEventSink({
		statsDir: join(homedir(), "neelopedia", "stats", "pi", "command-validator"),
		agent: "pi",
		namespace: "command-validator",
		sessionId,
		workspace: process.cwd(),
	});

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;

		const result = validator.validate(cmd, "bash");

		const telemetryData: Record<string, unknown> = {
			rawCommand: cmd.length > 500 ? cmd.slice(0, 500) + "…" : cmd,
			action: result.action,
			parentModel: lastModel ?? "unknown",
			thinkingLevel: lastThinking,
		};

		if (result.violations && result.violations.length > 0) {
			telemetryData.reason = result.violations.join("; ");
		}

		if (result.action === "deny") {
			sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });
			return { block: true, reason: result.violations.join("; ") };
		}

		if (result.action === "ask") {
			const ok = await ctx.ui.confirm(
				"Dangerous command",
				`Allow: ${cmd.slice(0, 100)}`,
			);
			
			telemetryData.action = ok ? "ask_approved" : "ask_rejected";
			telemetryData.userResponse = ok ? "yes" : "no";
			sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });
			
			if (!ok) {
				return { block: true, reason: "Blocked by user" };
			}
			return;
		}

		// Allow
		sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });
	});
}
