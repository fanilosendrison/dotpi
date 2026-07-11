/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { getPiPermissionScope } from "./shared/pi-permission-scope";
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
import {
	getPermissionScopeKey,
	isPermissionGrantedForScope,
} from "../../../.agents/agent-enforcers/permission-enforcer/src/core/state";

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "command-validator");

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		const isBash = isBashToolCall(event);
		const toolName = event.toolName || "Unknown";

		if (!shouldValidateRuntimeTool(toolName, isBash)) return;

		const scope = getPiPermissionScope(ctx);
		const permissionScope = getPermissionScopeKey(scope);
		const validator = new CommandValidator({
			isPermissionGranted: () => isPermissionGrantedForScope(scope),
		});

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
				{
					...createRuntimeValidationDetails(
						result,
						validationContext,
						overrides,
					),
					permissionScope,
				},
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
