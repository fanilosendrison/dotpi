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
	buildDirectGitDeniedReason,
	detectCommitIntent,
	detectRawGitMutation,
	evaluateEnforcement,
	isGitCommitsPushSkillCommand,
	TRUSTED_MARKER_ENV,
	TRUSTED_MARKER_VALUE,
	type CommitIntentDetection,
	type RawGitMutation,
} from "../../../.agents/agent-enforcers/git-commits-push-enforcer/src/core/validator";

export type { CommitIntentDetection, RawGitMutation };
export {
	buildDirectGitDeniedReason,
	detectRawGitMutation,
	detectCommitIntent,
	isGitCommitsPushSkillCommand,
};

// Compatibility aliases for existing tests that import these names.
/** @deprecated Use detectCommitIntent instead. */
export function isCommitIntent(cmd: string): boolean {
	return detectCommitIntent(cmd) !== null;
}
/** @deprecated Use isGitCommitsPushSkillCommand from the shared core instead. */
export function isSkillCmd(cmd: string): boolean {
	return isGitCommitsPushSkillCommand(cmd);
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
		// Pi is an agent-level interceptor (tool_call), not a subprocess-level
		// enforcer. Trust tokens are subprocess-level and validated only by
		// Gravity's PATH shim. We pass trustedSkillMarkerSet to the shared core
		// but intentionally omit trustToken + validateToken: if the marker
		// leaks into this process the core will fail-closed (block as forged).
		// This is safe — real trust tokens are never set in the Pi parent process.
		const trustedSkillMarkerSet =
			process.env[TRUSTED_MARKER_ENV] === TRUSTED_MARKER_VALUE;

		const result = evaluateEnforcement({
			command: cmd,
			legacyBypassSet,
			trustedSkillMarkerSet,
			// trustToken + validateToken intentionally omitted — see above.
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
