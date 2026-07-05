/**
 * Zero-timeout-filter stats logging module.
 *
 * Logs a timeout_stripped event each time a shell timeout is removed
 * from the git-commits-push skill invocation command.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

function atomicAppend(filePath: string, line: string): void {
	try {
		let existing = "";
		if (fs.existsSync(filePath)) {
			existing = fs.readFileSync(filePath, "utf-8");
		}
		const tmp = `${filePath}.tmp.${process.pid}`;
		fs.writeFileSync(tmp, existing + line);
		fs.renameSync(tmp, filePath);
	} catch (err) {
		process.stderr.write(`[zero-timeout-filter] Error writing stats: ${err}\n`);
	}
}

export interface StatsLogAPI {
	logTimeoutStripped(entry: {
		ts: string;
		originalTimeout: number;
		parentModel: string;
		thinkingLevel: string;
		sessionId: string;
		workspace: string;
	}): void;
}

export function createStatsLog(opts: { statsDir: string }): StatsLogAPI {
	const filePath = path.join(opts.statsDir, "events.jsonl");
	fs.mkdirSync(opts.statsDir, { recursive: true });

	return {
		logTimeoutStripped(entry) {
			const eventLine =
				JSON.stringify({
					timestamp: entry.ts,
					eventId: crypto.randomUUID(),
					extension: "zero-timeout-filter",
					eventType: "timeout_stripped",
					agent: "pi",
					workspace: entry.workspace,
					sessionId: entry.sessionId,
					details: {
						originalTimeout: entry.originalTimeout,
						parentModel: entry.parentModel,
						thinkingLevel: entry.thinkingLevel,
					},
				}) + "\n";
			atomicAppend(filePath, eventLine);
		},
	};
}
