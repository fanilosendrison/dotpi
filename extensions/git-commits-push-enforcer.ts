/**
 * Pi extension — intercepts every commit intent (raw git or /git-commits-push)
 * and routes it through the git-commits-push skill.
 *
 * Logs one event per trigger: enforcer_triggered with all context.
 *
 * Stats in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";

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

function readDefaultThinking(): string {
	try {
		const path = join(homedir(), ".pi", "agent", "settings.json");
		if (fs.existsSync(path)) {
			return (
				JSON.parse(fs.readFileSync(path, "utf-8")).defaultThinkingLevel ??
				"unknown"
			);
		}
	} catch {}
	return "unknown";
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
	let lastThinking: string = readDefaultThinking();

	const sink = createEventSink({
		statsDir,
		agent: "pi",
		namespace: "git-commits-push-enforcer",
		sessionId,
		workspace: process.cwd(),
	});

	// ── Capture model + thinking level ──────────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
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

		sink.append(
			"enforcer_triggered",
			{
				rawCommand: cmd,
				detectedBy,
				toolCallId: event.toolCallId,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			},
			{ timestamp: new Date().toISOString() },
		);
	});
}
