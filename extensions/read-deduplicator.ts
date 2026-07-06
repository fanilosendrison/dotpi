/**
 * Pi extension — deduplicates `read` tool calls by tracking which files
 * have already been injected into the context in this session.
 *
 * Blocks re-reads when: fingerprint matches AND file still in provider payload.
 * Allows re-reads when: first read, file modified, or content truncated from payload.
 *
 * Logs a file_access event per read attempt in
 * ~/neelopedia/stats/pi/read-deduplicator/events.jsonl
 *
 * Environment:
 *   RD_DRY_RUN=true — log blocks but do not actually block (debug mode).
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isReadToolResult,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";
import { createReadTracker } from "./read-deduplicator-internals/read-tracker";

// ── Fingerprint helpers ────────────────────────────────────────────────────

const FINGERPRINT_SAMPLE_BYTES = 4096;

function sampleFileHash(path: string): string {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return "err";
	}
	try {
		const buf = Buffer.alloc(FINGERPRINT_SAMPLE_BYTES);
		const n = readSync(fd, buf, 0, FINGERPRINT_SAMPLE_BYTES, 0);
		if (n === 0) return "empty";
		return createHash("sha256")
			.update(buf.subarray(0, n))
			.digest("hex")
			.slice(0, 16);
	} finally {
		try {
			closeSync(fd);
		} catch {}
	}
}

function computeFingerprint(
	path: string,
): { fingerprint: string; sizeBytes: number } | null {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(path);
	} catch {
		return null;
	}
	return {
		fingerprint: `${stat.mtimeMs}:${stat.size}:${sampleFileHash(path)}`,
		sizeBytes: stat.size,
	};
}

function readDefaultThinking(): string {
	try {
		const p = join(homedir(), ".pi", "agent", "settings.json");
		const { existsSync, readFileSync } = require("node:fs");
		if (existsSync(p)) {
			return (
				JSON.parse(readFileSync(p, "utf-8")).defaultThinkingLevel ?? "unknown"
			);
		}
	} catch {}
	return "unknown";
}

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
	const sink = createEventSink({
		statsDir,
		agent: "pi",
		namespace: "read-deduplicator",
	});

	let currentTurn = 0;
	let lastModel: string | undefined;
	let lastThinking: string = readDefaultThinking();

	// ── Capture model + thinking level ──────────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
	});

	// ── Session lifecycle ──────────────────────────────────────────────────

	pi.on("session_start", () => {
		// Stats dir already created by createEventSink
	});

	// ── Turn tracking ──────────────────────────────────────────────────────

	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
	});

	// ── Update context tracking before each provider request ───────────────

	pi.on("before_provider_request", async (event) => {
		const payload = event.payload as any;
		const messages = payload?.messages ?? [];
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
	});

	// ── Guard read calls ──────────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("read", event)) return;

		const input = event.input as any;
		const path = input.path ?? input.file_path ?? input.AbsolutePath;
		if (!path || typeof path !== "string") return;

		const fp = computeFingerprint(path);
		if (!fp) return;

		const { fingerprint, sizeBytes } = fp;
		const entry = tracker.get(path);

		const common = {
			ts: new Date().toISOString(),
			path,
			sizeBytes,
			turnIndex: currentTurn,
			parentModel: lastModel ?? "unknown",
			thinkingLevel: lastThinking,
			sessionId,
			workspace: process.cwd(),
		};

		// First read — always allow
		if (!entry) return;

		// File modified — allow
		if (entry.fingerprint !== fingerprint) return;

		// Same fingerprint, still in context — block
		if (entry.stillInContext) {
			sink.append(
				"file_access",
				{
					action: "blocked",
					path: common.path,
					sizeBytes: common.sizeBytes,
					turnIndex: common.turnIndex,
					parentModel: common.parentModel,
					thinkingLevel: common.thinkingLevel,
					blockedReason: `already in context (turn ${entry.turn})`,
				},
				{
					timestamp: common.ts,
					sessionId: common.sessionId,
					workspace: common.workspace,
				},
			);
			return {
				block: true,
				reason: `(already in context, turn ${entry.turn})`,
			};
		}

		// Same fingerprint, truncated from context — allow (falls through)
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

		const fp = computeFingerprint(path);
		if (!fp) return;

		const { fingerprint, sizeBytes } = fp;

		tracker.track(path, fingerprint, currentTurn, textContent);

		sink.append(
			"file_access",
			{
				action: "read",
				path,
				sizeBytes,
				turnIndex: currentTurn,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			},
			{
				timestamp: new Date().toISOString(),
				sessionId,
				workspace: process.cwd(),
			},
		);
	});
}
