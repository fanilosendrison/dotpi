/**
 * Pi extension — intercepts every commit intent (raw git or /git-commits-push)
 * and blocks direct raw git mutations.
 *
 * Detection and enforcement logic is centralized in the shared .agents core:
 *   ~/.agents/agent-enforcers/git-commits-push-enforcer/src/core/validator.ts
 *
 * Stats in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import {
	detectCommitIntent,
	detectRawGitMutation,
	evaluateEnforcement,
	TRUSTED_MARKER_ENV,
	TRUSTED_MARKER_VALUE,
	type CommitIntentDetection,
	type RawGitMutation,
} from "../../../.agents/agent-enforcers/git-commits-push-enforcer/src/core/validator";

export type { CommitIntentDetection, RawGitMutation };
export { detectRawGitMutation, detectCommitIntent };

// Compatibility aliases for existing tests that import these names.
/** @deprecated Use detectCommitIntent instead. */
export function isCommitIntent(cmd: string): boolean {
	return detectCommitIntent(cmd) !== null;
}
/** @deprecated Use isGitCommitsPushSkillCommand from the shared core instead. */
export function isSkillCmd(cmd: string): boolean {
	return /\/git-commits-push(?:\s|$)/.test(cmd) ||
		/\.agents\/skills\/git-commits-push(?:\s|\/|$)/.test(cmd);
}

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "git-commits-push-enforcer");

	// ── Intercept commit intent ─────────────────────────────────────────────
	//
	// Skill invocations are logged and allowed. Direct raw git mutations are
	// blocked so commits flow through the git-commits-push skill.

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;

		const legacyBypassSet = process.env.BYPASS_GIT_ENFORCER === "1";
		const trustedSkillMarkerSet =
			process.env[TRUSTED_MARKER_ENV] === TRUSTED_MARKER_VALUE;

		const result = evaluateEnforcement({
			command: cmd,
			legacyBypassSet,
			trustedSkillMarkerSet,
			allowLegacyBypass: true, // transitional compatibility
		});

		if (result.eventType === "skipped") {
			if (result.skipReason === "not-commit-intent") return;
			telemetry.sink.append("skipped", {
				rawCommand: cmd,
				detectedBy: result.detectedBy,
				mutation: result.mutation,
				reason: result.skipReason,
				toolCallId: event.toolCallId,
				parentModel: telemetry.model,
				thinkingLevel: telemetry.thinking,
			}, { timestamp: new Date().toISOString() });
			return;
		}

		const details = {
			rawCommand: cmd,
			detectedBy: result.detectedBy,
			toolCallId: event.toolCallId,
			parentModel: telemetry.model,
			thinkingLevel: telemetry.thinking,
			...(result.mutation ? { mutation: result.mutation } : {}),
		};

		if (result.action === "allow") {
			// Pass parent model/session to the skill via env vars.
			process.env.PI_PARENT_MODEL = telemetry.model;
			process.env.PI_SESSION_ID = telemetry.sessionId;

			telemetry.sink.append("enforcer_triggered", details, {
				timestamp: new Date().toISOString(),
			});
			return;
		}

		// result.action === "block"
		telemetry.sink.append("blocked", details, {
			timestamp: new Date().toISOString(),
		});

		return {
			block: true,
			reason: result.deniedReason ?? buildDirectGitDeniedReason(cmd),
		};
	});
}

// Re-export for backward compat (used by commit-msg-validator tests)
function buildDirectGitDeniedReason(command: string): string {
	const truncated = command.length <= 80 ? command : `${command.slice(0, 80)}...`;
	return [
		"Direct git commits are blocked. Use /git-commits-push instead.",
		"",
		`Got: "${truncated}"`,
	].join("\n");
}
