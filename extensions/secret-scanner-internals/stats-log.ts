/**
 * Secret-scanner stats logging module.
 *
 * One event type:
 *   scan_result → logged for every git commit scan
 *
 * No RAM counters, no session_summary — every state is materialized as an event.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Finding {
	name: string;
	line: string;
	lineNumber: number;
}

export interface StatsLogAPI {
	filePath: string;
	logResult(entry: {
		ts: string;
		status: "clean" | "blocked";
		findings?: Finding[];
		commitMsg?: string;
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

	function truncate(s: string, maxLen: number): string {
		if (s.length <= maxLen) return s;
		return s.slice(0, maxLen - 1) + "…";
	}

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
			process.stderr.write(`[secret-scanner] Error writing stats: ${err}\n`);
		}
	}

	return {
		filePath,

		logResult(entry) {
			const details: Record<string, unknown> = {
				status: entry.status,
				parentModel: entry.parentModel,
				thinkingLevel: entry.thinkingLevel,
			};
			if (entry.findings && entry.findings.length > 0) {
				details.findingsCount = entry.findings.length;
				details.findings = entry.findings.map((f) => ({
					...f,
					line: truncate(f.line, 80),
				}));
			}
			if (entry.commitMsg !== undefined) {
				details.commitMsg = truncate(entry.commitMsg, 100);
			}
			const event = {
				timestamp: entry.ts,
				eventId: crypto.randomUUID(),
				extension: "secret-scanner",
				eventType: "scan_result",
				agent: "pi",
				workspace: opts.cwd,
				sessionId: opts.sessionId,
				details,
			};
			atomicAppend(filePath, JSON.stringify(event) + "\n");
		},
	};
}
