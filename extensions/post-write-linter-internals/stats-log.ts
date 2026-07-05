/**
 * Post-write-linter stats logging module.
 *
 * One event type:
 *   lint_result → logged after every write/edit lint check
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
		process.stderr.write(`[post-write-linter] Error writing stats: ${err}\n`);
	}
}

export interface StatsLogAPI {
	filePath: string;
	logResult(entry: {
		ts: string;
		filePath: string;
		language: string;
		status: "success" | "error";
		output?: string;
		parentModel: string;
		thinkingLevel: string;
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
			extension: "post-write-linter",
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

		logResult(entry) {
			const details: Record<string, unknown> = {
				filePath: entry.filePath,
				language: entry.language,
				status: entry.status,
				parentModel: entry.parentModel,
				thinkingLevel: entry.thinkingLevel,
			};
			if (entry.output) {
				details.output =
					entry.output.length <= 500
						? entry.output
						: entry.output.slice(0, 500) + "…";
			}
			appendEvent("lint_result", details, entry.ts);
		},
	};
}
