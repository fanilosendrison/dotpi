/**
 * Path-guard stats logging module.
 *
 * Logs redirect events (write/edit) and bash rewrite events to
 * ~/neelopedia/stats/pi/path-guard/events.jsonl.
 *
 * Appends atomically via temp file + rename to survive concurrent writes
 * from multiple Pi sessions.
 *
 * Core shared logic (~/.agents/...) is NEVER touched — all logging lives
 * in this Pi-specific layer.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Atomic append ─────────────────────────────────────────────────────────
//
// Duplicated from read-deduplicator-internals/atomic-writer.ts (pas de
// factorisation tant que toutes les extensions n'ont pas leur logging).

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

// ── Public API types ──────────────────────────────────────────────────────

export interface StatsLogAPI {
	/** Full path to events.jsonl */
	filePath: string;

	/** Log a write/edit redirect. */
	addRedirect(entry: {
		ts: string;
		toolType: "write" | "edit";
		repo: string;
		givenPath: string;
		rewrittenTo: string;
	}): void;

	/** Log a bash command rewrite. */
	addBashRewrite(entry: {
		ts: string;
		repo: string;
		/** Original command (will be truncated to 200 chars). */
		originalCmd: string;
		pathsChanged: string[];
		redirectCount: number;
	}): void;

	/** Increment the correct-write counter (denominator). */
	incCorrectWrite(): void;

	/** Increment the correct-bash counter (denominator). */
	incCorrectBash(): void;

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

	let redirects = 0;
	let correctWrites = 0;
	let bashRewrites = 0;
	let correctBash = 0;
	const repos = new Set<string>();
	let cycleId = crypto.randomUUID();

	// ── Internal: write one event line ───────────────────────────────────

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
			cycleId,
			details,
		};
		atomicAppend(filePath, JSON.stringify(event) + "\n");
	}

	// ── Truncate helper ─────────────────────────────────────────────────

	function truncateCmd(cmd: string): string {
		if (cmd.length <= 200) return cmd;
		return cmd.slice(0, 200) + "…";
	}

	// ── Public API ──────────────────────────────────────────────────────

	return {
		filePath,

		addRedirect(entry) {
			redirects++;
			repos.add(entry.repo);
			appendEvent(
				"redirect",
				{
					toolType: entry.toolType,
					repo: entry.repo,
					givenPath: entry.givenPath,
					rewrittenTo: entry.rewrittenTo,
				},
				entry.ts,
			);
		},

		addBashRewrite(entry) {
			bashRewrites++;
			repos.add(entry.repo);
			appendEvent(
				"bash_rewrite",
				{
					repo: entry.repo,
					redirectCount: entry.redirectCount,
					originalCmd: truncateCmd(entry.originalCmd),
					pathsChanged: entry.pathsChanged,
				},
				entry.ts,
			);
		},

		incCorrectWrite() {
			correctWrites++;
		},

		incCorrectBash() {
			correctBash++;
		},

		flushSummary(event) {
			const writeTotal = redirects + correctWrites;
			const bashTotal = bashRewrites + correctBash;

			// Nothing to report — skip
			if (redirects === 0 && bashRewrites === 0) return;

			appendEvent(
				"session_summary",
				{
					model: event.model,
					redirects,
					correctWrites,
					writeTotal,
					writeRatio:
						writeTotal > 0
							? parseFloat((redirects / writeTotal).toFixed(2))
							: 0,
					bashRewrites,
					correctBash,
					bashTotal,
					bashRatio:
						bashTotal > 0
							? parseFloat((bashRewrites / bashTotal).toFixed(2))
							: 0,
					repos: [...repos].sort(),
				},
				event.endTs,
			);

			// Reset counters for potential next agent cycle in same session
			redirects = 0;
			correctWrites = 0;
			bashRewrites = 0;
			correctBash = 0;
			repos.clear();
			cycleId = crypto.randomUUID();
		},
	};
}
