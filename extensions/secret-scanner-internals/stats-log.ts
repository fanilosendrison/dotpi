/**
 * Secret-scanner stats logging module.
 *
 * Logs blocked commits (secrets detected) to
 * ~/neelopedia/stats/pi/secret-scanner/events.jsonl.
 *
 * Tracks all git commit scans for the blockRate ratio and
 * most frequent secret patterns.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicAppend } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/src/atomic-appender.ts";

// ── Finding type (mirror du core pour ne pas importer le core dans les tests)
// ── Public API types ──────────────────────────────────────────────────────

export interface Finding {
	name: string;
	line: string;
	lineNumber: number;
}

export interface StatsLogAPI {
	/** Full path to events.jsonl */
	filePath: string;

	/** Increment total scan counter (every git commit attempted). */
	incTotal(): void;

	/** Log a blocked commit with its findings. */
	addBlock(entry: {
		ts: string;
		findings: Finding[];
		commitMsg?: string;
	}): void;

	/** Increment clean scan counter (commit allowed). */
	incClean(): void;

	/** Flush a session_summary event. Resets all counters after flush. */
	flushSummary(event: {
		endTs: string;
		model?: string;
		totalTurns: number;
	}): void;
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createStatsLog(opts: {
	statsDir: string;
	sessionId: string;
	cwd: string;
}): StatsLogAPI {
	const filePath = path.join(opts.statsDir, "events.jsonl");

	// Ensure stats directory exists
	fs.mkdirSync(opts.statsDir, { recursive: true });

	// ── In-memory counters for the session ───────────────────────────────

	let totalScans = 0;
	let blocks = 0;
	let clean = 0;
	const patternCounts = new Map<string, number>();
	let cycleId = crypto.randomUUID();

	// ── Helpers ─────────────────────────────────────────────────────────

	function truncate(s: string, maxLen: number): string {
		if (s.length <= maxLen) return s;
		return s.slice(0, maxLen - 1) + "…";
	}

	// ── Internal: write one event line ───────────────────────────────────

	function appendEvent(
		eventType: string,
		details: Record<string, unknown>,
		timestamp?: string,
	): void {
		const event = {
			timestamp: timestamp || new Date().toISOString(),
			eventId: crypto.randomUUID(),
			extension: "secret-scanner",
			eventType,
			agent: "pi",
			workspace: opts.cwd,
			sessionId: opts.sessionId,
			cycleId,
			details,
		};
		atomicAppend(filePath, JSON.stringify(event) + "\n");
	}

	// ── Public API ──────────────────────────────────────────────────────

	return {
		filePath,

		incTotal() {
			totalScans++;
		},

		addBlock(entry) {
			blocks++;

			// Track patterns
			for (const f of entry.findings) {
				patternCounts.set(f.name, (patternCounts.get(f.name) || 0) + 1);
			}

			// Truncate finding lines to 80 chars
			const truncatedFindings = entry.findings.map((f) => ({
				...f,
				line: truncate(f.line, 80),
			}));

			const details: Record<string, unknown> = {
				findingsCount: entry.findings.length,
				findings: truncatedFindings,
			};

			if (entry.commitMsg !== undefined) {
				details.commitMsg = truncate(entry.commitMsg, 100);
			}

			appendEvent("block", details, entry.ts);
		},

		incClean() {
			clean++;
		},

		flushSummary(event) {
			// Rien à reporter si aucun scan n'a eu lieu
			if (totalScans === 0) return;

			// Patterns triés par fréquence décroissante, puis par nom
			const sortedPatterns = [...patternCounts.entries()]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.map(([name, count]) => ({ name, count }));

			appendEvent(
				"session_summary",
				{
					model: event.model,
					totalScans,
					blocks,
					clean,
					blockRate:
						totalScans > 0 ? parseFloat((blocks / totalScans).toFixed(2)) : 0,
					patterns: sortedPatterns,
				},
				event.endTs,
			);

			// Reset counters après flush
			totalScans = 0;
			blocks = 0;
			clean = 0;
			patternCounts.clear();
			cycleId = crypto.randomUUID();
		},
	};
}
