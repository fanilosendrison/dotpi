/**
 * Pi extension — intercepts every commit intent (raw git or /git-commits-push)
 * and routes it through the git-commits-push skill.
 *
 * Logs one event per trigger: enforcer_triggered with all context.
 *
 * Stats in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

import { createStatsLog } from "./git-commits-push-enforcer-internals/stats-log";

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
	const sessionId = crypto.randomUUID();
	const statsDir = join(
		homedir(),
		"neelopedia",
		"stats",
		"pi",
		"git-commits-push-enforcer",
	);
	let lastModel: string | undefined;

	const statsLog = createStatsLog({
		statsDir,
		sessionId,
		cwd: process.cwd(),
	});

	// ── Capture model ───────────────────────────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

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
		process.env.PI_PARENT_MODEL = lastModel ?? "unknown";
		process.env.PI_SESSION_ID = sessionId;

		// Read skill's settings.json to capture internal model
		let skillModel = "unknown";
		let skillProvider = "unknown";
		try {
			const skillDir = join(homedir(), ".agents", "skills", "git-commits-push");
			const settingsPath = join(skillDir, "src", "config", "settings.json");
			if (fs.existsSync(settingsPath)) {
				const raw = fs.readFileSync(settingsPath, "utf-8");
				const parsed = JSON.parse(raw);
				if (parsed.model) skillModel = parsed.model;
				if (parsed.provider) skillProvider = parsed.provider;
			}
		} catch {
			// Non-critical — proceed with "unknown"
		}

		statsLog.logTriggered({
			ts: new Date().toISOString(),
			rawCommand: cmd,
			detectedBy,
			toolCallId: event.toolCallId,
			parentModel: lastModel ?? "unknown",
			skillModel,
			skillProvider,
		});
	});
}
