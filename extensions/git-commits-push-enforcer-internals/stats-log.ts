/**
 * Git-commits-push-enforcer stats logging module.
 *
 * Two event types:
 *   commit_attempted → logged in tool_execution_start (raw LLM intent)
 *   skill_invoke     → logged in tool_call (successful routing to the skill)
 *
 * No RAM counters, no session_summary — every state is materialized as an event.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

function atomicAppend(filePath: string, newContent: string): void {
	try {
		let existingContent = "";
		if (fs.existsSync(filePath)) {
			existingContent = fs.readFileSync(filePath, "utf-8");
		}
		const combinedContent = existingContent + newContent;
		const tmpPath = `${filePath}.tmp.${process.pid}`;
		fs.writeFileSync(tmpPath, combinedContent);
		fs.renameSync(tmpPath, filePath);
	} catch (err) {
		process.stderr.write(
			`[git-commits-push-enforcer] Error writing stats: ${err}\n`,
		);
	}
}

export interface StatsLogAPI {
	filePath: string;
	logCommitAttempted(entry: {
		ts: string;
		rawCommand: string;
		detectedBy: "git-commit" | "git-commits-push";
		toolCallId: string;
	}): void;
	addSkillInvoke(entry: {
		ts: string;
		parentModel: string;
		skillModel: string;
		skillProvider: string;
	}): void;
}

export function createStatsLog(opts: {
	statsDir: string;
	sessionId: string;
	cwd: string;
}): StatsLogAPI {
	const filePath = path.join(opts.statsDir, "events.jsonl");
	fs.mkdirSync(opts.statsDir, { recursive: true });

	function appendEvent(
		eventType: string,
		details: Record<string, unknown>,
		timestamp?: string,
	): void {
		const event = {
			timestamp: timestamp || new Date().toISOString(),
			eventId: crypto.randomUUID(),
			extension: "git-commits-push-enforcer",
			eventType,
			agent: "pi",
			workspace: opts.cwd,
			sessionId: opts.sessionId,
			details,
		};
		atomicAppend(filePath, JSON.stringify(event) + "\n");
	}

	return {
		filePath,

		logCommitAttempted(entry) {
			appendEvent(
				"commit_attempted",
				{
					rawCommand: entry.rawCommand,
					detectedBy: entry.detectedBy,
					toolCallId: entry.toolCallId,
				},
				entry.ts,
			);
		},

		addSkillInvoke(entry) {
			appendEvent(
				"skill_invoke",
				{
					parentModel: entry.parentModel,
					skillModel: entry.skillModel,
					skillProvider: entry.skillProvider,
				},
				entry.ts,
			);
		},
	};
}
