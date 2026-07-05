/**
 * Path-guard stats logging module.
 *
 * One event type:
 *   path_access → logged for every dot* path access, with action field
 *                 indicating whether it was rewritten or already correct.
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
		process.stderr.write(`[path-guard] Error writing stats: ${err}\n`);
	}
}

export interface StatsLogAPI {
	filePath: string;
	logAccess(entry: {
		ts: string;
		toolType: "write" | "edit" | "bash";
		repo: string;
		action: "redirected" | "correct";
		givenPath: string;
		rewrittenTo?: string;
		originalCmd?: string;
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
			extension: "path-guard",
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

		logAccess(entry) {
			const details: Record<string, unknown> = {
				toolType: entry.toolType,
				repo: entry.repo,
				action: entry.action,
				givenPath: entry.givenPath,
			};
			if (entry.rewrittenTo) {
				details.rewrittenTo = entry.rewrittenTo;
			}
			if (entry.originalCmd) {
				details.originalCmd =
					entry.originalCmd.length <= 200
						? entry.originalCmd
						: entry.originalCmd.slice(0, 200) + "…";
			}
			details.parentModel = entry.parentModel;
			details.thinkingLevel = entry.thinkingLevel;
			appendEvent("path_access", details, entry.ts);
		},
	};
}
