/**
 * Read-deduplicator stats logging module.
 *
 * One event type:
 *   file_access → logged for every read attempt, with action indicating outcome.
 *
 * No RAM counters, no cycle_summary — every state is materialized as an event.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { atomicAppend } from "./atomic-writer";

export interface FileAccessEntry {
	ts: string;
	action: "attempted" | "blocked" | "read";
	path: string;
	sizeBytes: number;
	turnIndex: number;
	parentModel: string;
	thinkingLevel: string;
	sessionId: string;
	workspace: string;
	blockedReason?: string;
}

export interface BlockedLogAPI {
	filePath: string;
	logFileAccess(entry: FileAccessEntry): void;
}

export function createBlockedLog(opts: {
	statsDir: string;
	sessionId?: string;
	cwd: string;
}): BlockedLogAPI {
	const sessionId = opts.sessionId || crypto.randomUUID();
	const filePath = join(opts.statsDir, "events.jsonl");
	fs.mkdirSync(opts.statsDir, { recursive: true });

	return {
		filePath,

		logFileAccess(entry) {
			const details: Record<string, unknown> = {
				action: entry.action,
				path: entry.path,
				sizeBytes: entry.sizeBytes,
				turnIndex: entry.turnIndex,
				parentModel: entry.parentModel,
				thinkingLevel: entry.thinkingLevel,
			};
			if (entry.blockedReason) {
				details.blockedReason = entry.blockedReason;
			}
			const event = {
				timestamp: entry.ts,
				eventId: crypto.randomUUID(),
				extension: "read-deduplicator",
				eventType: "file_access",
				agent: "pi",
				workspace: entry.workspace,
				sessionId: entry.sessionId,
				details,
			};
			atomicAppend(filePath, JSON.stringify(event) + "\n");
		},
	};
}
