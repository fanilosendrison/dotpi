/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { CommandValidator } from "../../../.agents/agent-enforcers/command-validator/src/core/validator.ts";
import { RESTRICTED_TOOLS } from "../../../.agents/agent-enforcers/command-validator/src/core/tool-rules.ts";

export default function (pi: ExtensionAPI) {
	const validator = new CommandValidator();
	const telemetry = createPiTelemetry(pi, "command-validator");

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		const isBash = isToolCallEventType("bash", event);
		const toolName = event.toolName || "Unknown";
		const isRestricted = RESTRICTED_TOOLS.includes(toolName);

		if (!isBash && !isRestricted) return;

		let cmd: unknown;
		if (isBash) {
			cmd = (event.input as any).command;
			if (!cmd || typeof cmd !== "string") return;
		}

		const result = validator.validate(cmd, toolName);

		const rawCommandStr = typeof cmd === "string" ? cmd : "";
		const telemetryData: Record<string, unknown> = {
			rawCommand: rawCommandStr.length > 500 ? rawCommandStr.slice(0, 500) + "…" : rawCommandStr,
			action: result.action,
			parentModel: telemetry.model,
			thinkingLevel: telemetry.thinking,
			toolName,
		};

		if (result.violations && result.violations.length > 0) {
			telemetryData.reason = result.violations.join("; ");
		}

		if (result.action === "deny") {
			telemetry.sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });
			return { block: true, reason: result.violations.join("; ") };
		}

		if (result.action === "ask") {
			const ok = await ctx.ui.confirm(
				"Dangerous command",
				`Allow: ${rawCommandStr.slice(0, 100)}`,
			);

			telemetryData.action = ok ? "ask_approved" : "ask_rejected";
			telemetryData.userResponse = ok ? "yes" : "no";
			telemetry.sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });

			if (!ok) {
				return { block: true, reason: "Blocked by user" };
			}
			return;
		}

		// Allow
		telemetry.sink.append("validation_result", telemetryData, { timestamp: new Date().toISOString() });
	});
}
