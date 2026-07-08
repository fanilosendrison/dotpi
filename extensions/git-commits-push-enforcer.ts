/**
 * Pi extension — intercepts every commit intent (raw git or /git-commits-push)
 * and routes it through the git-commits-push skill.
 *
 * Logs one event per trigger: enforcer_triggered with all context.
 *
 * Stats in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";

const GIT_COMMIT = /git\s+commit\b/;

const SKILL_CMD = /\/git-commits-push(?:\s|$)/;

/** True when the command is a skill invocation (/git-commits-push or launch command). */
function isSkillCmd(cmd: string): boolean {
	return SKILL_CMD.test(cmd) || cmd.includes(".agents/skills/git-commits-push");
}

/** True when the command represents a commit intent (raw git or skill). */
function isCommitIntent(cmd: string): boolean {
	return GIT_COMMIT.test(cmd) || isSkillCmd(cmd);
}

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "git-commits-push-enforcer");

	// ── Intercept commit intent and log ─────────────────────────────────────
	//
	// Every commit intent (raw git or skill invocation) is intercepted here
	// and passed through to the git-commits-push skill. No validation — the
	// skill handles that.

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!isCommitIntent(cmd)) return;

		const detectedBy = isSkillCmd(cmd) ? "git-commits-push" : "git-commit";

		// Pass parent model/session to the skill via env vars
		process.env.PI_PARENT_MODEL = telemetry.model;
		process.env.PI_SESSION_ID = telemetry.sessionId;

		telemetry.sink.append(
			"enforcer_triggered",
			{
				rawCommand: cmd,
				detectedBy,
				toolCallId: event.toolCallId,
				parentModel: telemetry.model,
				thinkingLevel: telemetry.thinking,
			},
			{ timestamp: new Date().toISOString() },
		);
	});
}

