/**
 * Pi extension — deduplicates `read` tool calls by tracking which files
 * have already been injected into the context in this session.
 *
 * Blocks re-reads when: fingerprint matches AND file still in provider payload.
 * Allows re-reads when: first read, file modified, or content truncated from payload.
 *
 * Logs blocked reads to ~/neelopedia/stats/read-deduplicator/<session-id>.md
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isReadToolResult,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { createBlockedLog } from "./read-deduplicator-internals/blocked-log";
import { createReadTracker } from "./read-deduplicator-internals/read-tracker";

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	const tracker = createReadTracker();
	const statsDir = join(
		homedir(),
		"neelopedia",
		"stats",
		"pi",
		"read-deduplicator",
	);
	const blockedLog = createBlockedLog({
		statsDir,
		sessionId,
		cwd: process.cwd(),
		dryRun: false,
	});

	let currentTurn = 0;
	let cycleStartTs = "";
	let cycleReadsAttempted = 0;
	const cycleTurns = new Set<number>();

	// ── Session lifecycle ──────────────────────────────────────────────────

	pi.on("session_start", () => {
		blockedLog.startSession();
	});

	pi.on("agent_start", () => {
		cycleStartTs = new Date().toISOString();
		cycleReadsAttempted = 0;
		cycleTurns.clear();
		blockedLog.onAgentStart({ timestamp: cycleStartTs });
	});

	pi.on("agent_end", () => {
		blockedLog.onAgentEnd({
			timestamp: new Date().toISOString(),
			totalTurns: currentTurn,
		});
	});

	// ── Turn tracking ──────────────────────────────────────────────────────

	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
		cycleTurns.add(event.turnIndex);
		blockedLog.onTurnStart({ turnIndex: event.turnIndex });
	});

	// ── Cycle boundary: before each provider request ─────────────────────

	pi.on("before_provider_request", async (event) => {
		// Update stillInContext for all tracked files
		const messages = (event.payload as any)?.messages ?? [];
		const payloadText = messages
			.flatMap((m: any) =>
				Array.isArray(m.content)
					? m.content
							.filter((c: any) => c.type === "text")
							.map((c: any) => c.text)
					: [typeof m.content === "string" ? m.content : ""],
			)
			.join("\n");
		for (const [path, entry] of tracker.entries()) {
			tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
		}

		// End the current cycle — flush blocked reads to file
		const endTs = new Date().toISOString();
		if (cycleStartTs) {
			blockedLog.endCycle({
				startTs: cycleStartTs,
				endTs,
				readsAttempted: cycleReadsAttempted,
				totalTurns: cycleTurns.size,
			});
		}
		cycleStartTs = endTs;
		cycleReadsAttempted = 0;
		cycleTurns.clear();
	});

	// ── Guard read calls ──────────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("read", event)) return;

		const input = event.input as any;
		const path = input.path ?? input.file_path ?? input.AbsolutePath;
		if (!path || typeof path !== "string") return;

		cycleReadsAttempted++;

		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			return; // file doesn't exist yet — let read handle the error
		}

		const fingerprint = `${stat.mtimeMs}:${stat.size}`;
		const entry = tracker.get(path);

		// First read — always allow
		if (!entry) return;

		// File modified — allow (tracker will be updated in tool_result)
		if (entry.fingerprint !== fingerprint) return;

		// Same fingerprint, still in context — block
		if (entry.stillInContext) {
			blockedLog.addBlock({
				ts: new Date().toISOString(),
				path,
				sizeBytes: stat.size,
				turnIndex: currentTurn,
			});
			return {
				block: true,
				reason: `(already in context, turn ${entry.turn})`,
			};
		}

		// Same fingerprint, but truncated from context — allow
	});

	// ── Capture injected text after successful reads ─────────────────────

	pi.on("tool_result", async (event) => {
		if (!isReadToolResult(event)) return;

		const input = event.input as any;
		const path = (input.path ??
			input.file_path ??
			input.AbsolutePath) as string;
		if (!path || typeof path !== "string") return;

		const textContent = event.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (!textContent) return;

		let fingerprint: string;
		try {
			const stat = statSync(path);
			fingerprint = `${stat.mtimeMs}:${stat.size}`;
		} catch {
			return;
		}

		tracker.track(path, fingerprint, currentTurn, textContent);
	});
}
