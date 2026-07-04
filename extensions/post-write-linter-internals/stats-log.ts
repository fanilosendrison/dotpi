/**
 * Post-write-linter stats logging module.
 *
 * Logs lint errors to ~/neelopedia/stats/pi/post-write-linter/events.jsonl.
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
	incClean(): void;
	addLintError(entry: {
		ts: string;
		filePath: string;
		language: string;
		output: string;
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

	let errors = 0;
	let clean = 0;
	let cycleId = crypto.randomUUID();

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
			cycleId,
			details,
		};
		atomicAppend(filePath, JSON.stringify(event) + "\n");
	}

	function truncate(str: string, max: number): string {
		if (str.length <= max) return str;
		return str.slice(0, max) + "…";
	}

	return {
		filePath,

		incClean() {
			clean++;
		},

		addLintError(entry) {
			errors++;
			appendEvent(
				"lint_error",
				{
					filePath: entry.filePath,
					language: entry.language,
					output: truncate(entry.output, 500),
				},
				entry.ts,
			);
		},

		flushSummary(event) {
			const totalChecked = errors + clean;
			if (totalChecked === 0) return;

			appendEvent(
				"session_summary",
				{
					model: event.model,
					totalChecked,
					errors,
					clean,
					errorRate:
						totalChecked > 0
							? parseFloat((errors / totalChecked).toFixed(2))
							: 0,
				},
				event.endTs,
			);

			errors = 0;
			clean = 0;
			cycleId = crypto.randomUUID();
		},
	};
}
