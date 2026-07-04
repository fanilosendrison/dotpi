/**
 * Command-validator stats logging module.
 *
 * Logs deny and ask_confirm events to
 * ~/neelopedia/stats/pi/command-validator/events.jsonl.
 *
 * Appends atomically via temp file + rename to survive concurrent writes
 * from multiple Pi sessions.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Atomic append ─────────────────────────────────────────────────────────

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
		process.stderr.write(`[command-validator] Error writing stats: ${err}\n`);
	}
}

// ── Public API types ──────────────────────────────────────────────────────

export interface StatsLogAPI {
	/** Full path to events.jsonl */
	filePath: string;

	/** Increment total command counter (called for every bash command). */
	incTotal(): void;

	/** Log an automatically blocked command. */
	addDeny(entry: {
		ts: string;
		severity: string;
		violations: string[];
		command: string;
	}): void;

	/** Log a user confirmation interaction. */
	addAskConfirm(entry: {
		ts: string;
		tool: string;
		severity: string;
		outcome: "allowed" | "denied";
		command: string;
	}): void;

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

	fs.mkdirSync(opts.statsDir, { recursive: true });

	// ── In-memory counters for the session ───────────────────────────────

	let totalCommands = 0;
	let denied = 0;
	let asked = 0;
	let userDenied = 0;
	let userAllowed = 0;
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
			extension: "command-validator",
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

		incTotal() {
			totalCommands++;
		},

		addDeny(entry) {
			denied++;
			appendEvent(
				"deny",
				{
					severity: entry.severity,
					violations: entry.violations,
					command: truncateCmd(entry.command),
				},
				entry.ts,
			);
		},

		addAskConfirm(entry) {
			asked++;
			if (entry.outcome === "denied") {
				userDenied++;
			} else {
				userAllowed++;
			}
			appendEvent(
				"ask_confirm",
				{
					tool: entry.tool,
					severity: entry.severity,
					outcome: entry.outcome,
					command: truncateCmd(entry.command),
				},
				entry.ts,
			);
		},

		flushSummary(event) {
			// Nothing to report — skip (only summary if at least one deny or ask)
			if (denied === 0 && asked === 0) return;

			appendEvent(
				"session_summary",
				{
					model: event.model,
					totalCommands,
					denied,
					asked,
					userDenied,
					userAllowed,
					denyRate:
						totalCommands > 0
							? parseFloat((denied / totalCommands).toFixed(2))
							: 0,
					confirmRate:
						asked > 0 ? parseFloat((userAllowed / asked).toFixed(2)) : 0,
				},
				event.endTs,
			);

			// Reset counters for potential next agent cycle
			totalCommands = 0;
			denied = 0;
			asked = 0;
			userDenied = 0;
			userAllowed = 0;
			cycleId = crypto.randomUUID();
		},
	};
}
