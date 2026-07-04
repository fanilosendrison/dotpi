import * as crypto from "node:crypto";
import { atomicAppend } from "./atomic-writer";
import { loadPathFilter, matchesFilter, normalizePath } from "./path-normalize";
import { ensureDirectory, resolveSessionFilePath } from "./session-file";

export interface AddBlockResult {
	blocked: boolean;
	logged: boolean;
}

export interface BlockedLogAPI {
	filePath: string;
	currentCycleBlockCount: number;
	startSession(): void;
	addBlock(entry: {
		ts: string;
		path: string;
		sizeBytes: number;
		turnIndex: number;
	}): AddBlockResult;
	addRead(entry: {
		ts: string;
		path: string;
		sizeBytes: number;
		turnIndex: number;
	}): AddBlockResult;
	endCycle(meta: {
		startTs: string;
		endTs: string;
		readsAttempted: number;
		totalTurns: number;
	}): void;
	onAgentStart(event: { timestamp: string }): void;
	onTurnStart(event: { turnIndex: number }): void;
	onAgentEnd(event: {
		timestamp: string;
		totalTurns?: number;
		readsAttempted?: number;
		model?: string;
	}): void;
	setStatusCallback(fn: (key: string, msg: string) => void): void;
}

export function createBlockedLog(opts: {
	statsDir: string;
	sessionId?: string;
	cwd: string;
	dryRun: boolean;
	forceFilePath?: string;
}): BlockedLogAPI {
	const filePath = resolveSessionFilePath(
		opts.statsDir,
		opts.sessionId,
		opts.forceFilePath,
	);
	let pathFilters: string[] = [];

	let currentTurnIndex = 0;
	let cycleReadsAttempted = 0;
	let totalSessionBlocked = 0;
	let cycleBlockedCount = 0;
	let statusCallback: ((key: string, msg: string) => void) | null = null;
	let cycleStartTs: string | null = null;
	let cycleId: string = crypto.randomUUID();

	const sessionId = opts.sessionId || crypto.randomUUID();

	function appendEvent(
		eventType: string,
		details: any,
		timestamp?: string,
		eventCycleId?: string,
	) {
		if (opts.dryRun) return;
		const event = {
			timestamp: timestamp || new Date().toISOString(),
			eventId: crypto.randomUUID(),
			extension: "read-deduplicator",
			eventType,
			agent: "pi",
			workspace: opts.cwd,
			sessionId,
			cycleId: eventCycleId || cycleId,
			details,
		};
		try {
			atomicAppend(filePath, JSON.stringify(event) + "\n");
		} catch (e) {
			process.stderr.write(`[read-deduplicator] Error appending JSON: ${e}\n`);
		}
	}

	return {
		filePath,

		get currentCycleBlockCount() {
			return cycleBlockedCount;
		},

		startSession() {
			ensureDirectory(opts.statsDir);
			pathFilters = loadPathFilter(opts.statsDir);
		},

		addBlock(entry) {
			try {
				const normalized = normalizePath(entry.path, opts.cwd);
				if (!normalized) {
					return { blocked: false, logged: false };
				}

				if (matchesFilter(normalized, pathFilters)) {
					return { blocked: true, logged: false };
				}

				appendEvent(
					"block",
					{
						path: normalized,
						sizeBytes: entry.sizeBytes,
						turnIndex: entry.turnIndex,
					},
					entry.ts,
				);

				totalSessionBlocked++;
				cycleBlockedCount++;

				if (statusCallback) {
					statusCallback("rd", `${totalSessionBlocked} reads bloqués`);
				}

				if (!cycleStartTs) {
					cycleStartTs = entry.ts;
				}

				return { blocked: !opts.dryRun, logged: true };
			} catch (err) {
				process.stderr.write(
					`[read-deduplicator] Error adding block: ${err}\n`,
				);
				return { blocked: true, logged: false };
			}
		},

		addRead(entry) {
			try {
				const normalized = normalizePath(entry.path, opts.cwd);
				if (!normalized) {
					return { blocked: false, logged: false };
				}

				if (matchesFilter(normalized, pathFilters)) {
					return { blocked: false, logged: false };
				}

				appendEvent(
					"read",
					{
						path: normalized,
						sizeBytes: entry.sizeBytes,
						turnIndex: entry.turnIndex,
					},
					entry.ts,
				);

				return { blocked: false, logged: true };
			} catch (err) {
				process.stderr.write(`[read-deduplicator] Error adding read: ${err}\n`);
				return { blocked: false, logged: false };
			}
		},

		endCycle(meta) {
			try {
				if (meta.readsAttempted > 0 || cycleBlockedCount > 0) {
					appendEvent(
						"cycle_summary",
						{
							startTs: meta.startTs,
							endTs: meta.endTs,
							readsAttempted: meta.readsAttempted,
							blockedCount: cycleBlockedCount,
							totalTurns: meta.totalTurns,
							model: meta.model,
						},
						meta.endTs,
					);
				}
				cycleStartTs = meta.endTs;
				cycleReadsAttempted = 0;
				cycleBlockedCount = 0;
				cycleId = crypto.randomUUID();
			} catch (err) {
				process.stderr.write(
					`[read-deduplicator] Error ending cycle: ${err}\n`,
				);
			}
		},

		onAgentStart(event) {
			cycleStartTs = event.timestamp;
			cycleReadsAttempted = 0;
			cycleBlockedCount = 0;
			cycleId = crypto.randomUUID();
		},

		onTurnStart(event) {
			currentTurnIndex = event.turnIndex;
		},

		onAgentEnd(event) {
			if (cycleReadsAttempted > 0 || cycleBlockedCount > 0) {
				appendEvent(
					"cycle_summary",
					{
						startTs: cycleStartTs || event.timestamp,
						endTs: event.timestamp,
						readsAttempted: cycleReadsAttempted || event.readsAttempted || 0,
						blockedCount: cycleBlockedCount,
						totalTurns: event.totalTurns ?? 1,
						model: event.model,
					},
					event.timestamp,
				);
			}
			cycleReadsAttempted = 0;
			cycleBlockedCount = 0;
		},

		setStatusCallback(fn) {
			statusCallback = fn;
		},
	};
}
