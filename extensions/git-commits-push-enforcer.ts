/**
 * Pi extension — blocks direct git commit unless message follows Conventional Commits
 * AND the commit is followed by a push.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/git-commits-push-enforcer/.
 * Forces the agent to use /git-commits-push.
 *
 * Stats logging: counts blocked commits and skill invocations per session/model
 * in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const VALIDATOR_PATH = join(
	homedir(),
	".agents/agent-enforcers/git-commits-push-enforcer/src/core/validator",
);
const { isGitCommit, extractMessage, isValidCC, hasPush } =
	require(VALIDATOR_PATH);

import { createStatsLog } from "./git-commits-push-enforcer-internals/stats-log";

/** True when the command represents a commit intent (raw git or skill). */
function isCommitIntent(cmd: string): boolean {
	return isGitCommit(cmd) || cmd.includes("git-commits-push");
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

	// ── Guard bash commands ─────────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;

		// Count any commit intent (raw git or skill invocation)
		if (!isCommitIntent(cmd)) return;
		statsLog.incTotal();

		// Skill invocation — log models, pass env vars, let it pass
		if (cmd.includes("git-commits-push")) {
			// Pass parent model/session to the skill via env vars
			process.env.PI_PARENT_MODEL = lastModel ?? "unknown";
			process.env.PI_SESSION_ID = sessionId;
			// Read skill's settings.json to capture internal model
			let skillModel = "unknown";
			let skillProvider = "unknown";
			try {
				const skillDir = join(
					homedir(),
					".agents",
					"skills",
					"git-commits-push",
				);
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
			statsLog.addSkillInvoke({
				ts: new Date().toISOString(),
				parentModel: lastModel ?? "unknown",
				skillModel,
				skillProvider,
			});
			return;
		}

		// Raw git commit — validate
		if (!isGitCommit(cmd)) return;

		const msg = extractMessage(cmd);
		if (msg === null) return;

		if (!isValidCC(msg)) {
			statsLog.addBlockCC({
				ts: new Date().toISOString(),
				message: msg,
			});
			return {
				block: true,
				reason:
					"Use /git-commits-push to generate a Conventional Commits message.\n" +
					`Got: "${msg.slice(0, 60)}" — expected: <type>(<scope>): <description>`,
			};
		}

		if (!hasPush(cmd)) {
			statsLog.addBlockPush({
				ts: new Date().toISOString(),
				message: msg,
			});
			return {
				block: true,
				reason:
					"Always push after commit. Use: git commit ... && git push\n" +
					"Or invoke /git-commits-push which handles this automatically.",
			};
		}

		// Commit passed validation
		statsLog.incAllowedRaw();
	});

	// ── Flush session summary at session end ────────────────────────────────

	pi.on("session_shutdown", () => {
		statsLog.flushSummary({
			endTs: new Date().toISOString(),
			model: lastModel,
			totalTurns: 0,
		});
	});
}
