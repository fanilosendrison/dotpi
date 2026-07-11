/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { getBashCommand, isBashToolCall } from "./shared/pi-tool-events";
import { CommandValidator } from "../../../.agents/agent-enforcers/command-validator/src/core/validator.ts";
import {
	createRuntimeValidationDetails,
	formatPiConfirmationMessage,
	formatValidationReason,
	normalizeRawCommand,
	shouldValidateRuntimeTool,
	type RuntimeValidationOverrides,
} from "../../../.agents/agent-enforcers/command-validator/src/core/runtime-contract.ts";

export default function (pi: ExtensionAPI) {
	const validator = new CommandValidator();
	const telemetry = createPiTelemetry(pi, "command-validator");

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		const isBash = isBashToolCall(event);
		const toolName = event.toolName || "Unknown";

		if (!shouldValidateRuntimeTool(toolName, isBash)) return;

		let cmd: unknown;
		if (isBash) {
			cmd = getBashCommand(event);
			if (cmd === null) return;
		}

		const result = validator.validate(cmd, toolName);
		const rawCommandStr = normalizeRawCommand(cmd);
		const validationContext = {
			rawCommand: cmd,
			toolName,
			...telemetry.contextDetails(),
		};

		function emitTelemetry(overrides?: RuntimeValidationOverrides) {
			telemetry.append(
				"validation_result",
				createRuntimeValidationDetails(result, validationContext, overrides),
			);
		}

		if (result.action === "deny") {
			emitTelemetry();
			return { block: true, reason: formatValidationReason(result) };
		}

		if (result.action === "ask") {
			const ok = await ctx.ui.confirm(
				"Dangerous command",
				formatPiConfirmationMessage(rawCommandStr),
			);

			emitTelemetry({
				action: ok ? "ask_approved" : "ask_rejected",
				userResponse: ok ? "yes" : "no",
			});

			if (!ok) {
				return { block: true, reason: "Blocked by user" };
			}
			return;
		}

		// Allow
		emitTelemetry();
	});
}
