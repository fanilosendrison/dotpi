/**
 * Git-commits-push-enforcer stats logging module.
 *
 * Logs blocked commits to ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 * Tracks all commit intents (raw bash + skill invocations) for the blockRate ratio.
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
	incTotal(): void;
	addBlockCC(entry: { ts: string; message: string }): void;
	addBlockPush(entry: { ts: string; message: string }): void;
	incAllowedRaw(): void;
	incSkillInvoked(): void;
	addSkillInvoke(entry: {
		ts: string;
		parentModel: string;
		skillModel: string;
		skillProvider: string;
	}): void;
	flushSummary(event: {
		endTs: string;
		model?: string;
		totalTurns: number;
	}): void;
}

export function createStatsLog(opts: {
	statsDir: string;
	sessionId: string;
	cwd: string;
}): StatsLogAPI {
	const filePath = path.join(opts.statsDir, "events.jsonl");
	fs.mkdirSync(opts.statsDir, { recursive: true });

	let totalCommits = 0;
	let blockedCC = 0;
	let blockedPush = 0;
	let allowedRaw = 0;
	let skillInvoked = 0;
	let lastParentModel: string | undefined;
	let lastSkillModel: string | undefined;
	let lastSkillProvider: string | undefined;
	let cycleId = crypto.randomUUID();

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
			cycleId,
			details,
		};
		atomicAppend(filePath, JSON.stringify(event) + "\n");
	}

	return {
		filePath,

		incTotal() {
			totalCommits++;
		},

		addBlockCC(entry) {
			blockedCC++;
			appendEvent("block_cc", { message: entry.message }, entry.ts);
		},

		addBlockPush(entry) {
			blockedPush++;
			appendEvent("block_push", { message: entry.message }, entry.ts);
		},

		incAllowedRaw() {
			allowedRaw++;
		},

		incSkillInvoked() {
			skillInvoked++;
		},

		addSkillInvoke(entry) {
			skillInvoked++;
			lastParentModel = entry.parentModel;
			lastSkillModel = entry.skillModel;
			lastSkillProvider = entry.skillProvider;
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

		flushSummary(event) {
			if (totalCommits === 0) return;

			appendEvent(
				"session_summary",
				{
					model: event.model,
					totalCommits,
					blockedCC,
					blockedPush,
					allowedRaw,
					skillInvoked,
					parentModel: lastParentModel,
					skillModel: lastSkillModel,
					skillProvider: lastSkillProvider,
					blockRate:
						totalCommits > 0
							? parseFloat(
									((blockedCC + blockedPush) / totalCommits).toFixed(2),
								)
							: 0,
				},
				event.endTs,
			);

			totalCommits = 0;
			blockedCC = 0;
			blockedPush = 0;
			allowedRaw = 0;
			skillInvoked = 0;
			cycleId = crypto.randomUUID();
		},
	};
}
