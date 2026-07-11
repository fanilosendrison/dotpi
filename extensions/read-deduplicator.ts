/**
 * Pi extension — deduplicates `read` tool calls by tracking which files
 * have already been injected into the context in this session.
 *
 * Serves cached text when: fingerprint and read line range both match.
 * Allows normal reads when: first read, file modified, or offset/limit differ.
 *
 * Logs a file_access event per read attempt in
 * ~/neelopedia/stats/pi/read-deduplicator/events.jsonl
 *
 * Environment:
 *   RD_DRY_RUN=true — legacy no-op, kept for compatibility with existing env.
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	isReadToolResult,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { getReadPath } from "./shared/pi-tool-inputs";
import { createReadTracker } from "./read-deduplicator-internals/read-tracker";

// ── Fingerprint helpers ────────────────────────────────────────────────────

const FINGERPRINT_SAMPLE_BYTES = 4096;

interface ProviderTextBlock {
	type: "text";
	text: string;
}

interface ProviderMessage {
	content?: unknown;
}

interface PendingCacheServe {
	path: string;
	fingerprint: string;
	cachedText: string;
}

function isProviderTextBlock(value: unknown): value is ProviderTextBlock {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "text" &&
		typeof (value as { text?: unknown }).text === "string"
	);
}

function getOptionalNumberField(
	input: { offset?: unknown; limit?: unknown },
	field: "offset" | "limit",
): number | undefined {
	const value = input[field];
	return typeof value === "number" ? value : undefined;
}

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

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "read-deduplicator");
	const tracker = createReadTracker();
	const pendingCacheServes = new Map<string, PendingCacheServe>();

	let currentTurn = 0;

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
		const payload = event.payload as { messages?: ProviderMessage[] };
		const messages = Array.isArray(payload.messages) ? payload.messages : [];
		const payloadText = messages
			.flatMap((message) => {
				if (Array.isArray(message.content)) {
					return message.content
						.filter(isProviderTextBlock)
						.map((content) => content.text);
				}

				return [typeof message.content === "string" ? message.content : ""];
			})
			.join("\n");

		for (const [path, entry] of tracker.entries()) {
			tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
		}
	});

	// ── Guard read calls ──────────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("read", event)) return;

		const path = getReadPath(event.input as Record<string, unknown>);
		if (path === null) return;

		const fp = computeFingerprint(path);
		if (!fp) return;

		const { fingerprint } = fp;
		const offset = getOptionalNumberField(event.input, "offset");
		const limit = getOptionalNumberField(event.input, "limit");
		const cachedText = tracker.getCacheHit(path, fingerprint, offset, limit);

		if (cachedText !== undefined) {
			pendingCacheServes.set(event.toolCallId, {
				path,
				fingerprint,
				cachedText,
			});
		}
	});

	// ── Capture injected text after successful reads ─────────────────────

	pi.on("tool_result", async (event) => {
		if (!isReadToolResult(event)) return;

		const path = getReadPath(event.input);
		if (path === null) return;

		const pendingCacheServe = pendingCacheServes.get(event.toolCallId);
		if (pendingCacheServe) {
			pendingCacheServes.delete(event.toolCallId);
			const fp = computeFingerprint(path);

			if (
				path === pendingCacheServe.path &&
				fp?.fingerprint === pendingCacheServe.fingerprint
			) {
				telemetry.append(
					"file_access",
					{
						action: "cache_served",
						path,
						sizeBytes: fp.sizeBytes,
						turnIndex: currentTurn,
					},
					{
						timestamp: new Date().toISOString(),
						sessionId: telemetry.sessionId,
						workspace: process.cwd(),
					},
				);

				return {
					content: [{ type: "text", text: pendingCacheServe.cachedText }],
					details: event.details,
					isError: false,
				};
			}
		}

		const textContent = event.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (!textContent) return;

		const fp = computeFingerprint(path);
		if (!fp) return;

		const { fingerprint, sizeBytes } = fp;
		const offset = getOptionalNumberField(event.input, "offset");
		const limit = getOptionalNumberField(event.input, "limit");

		tracker.track(path, fingerprint, currentTurn, textContent, offset, limit);

		telemetry.append(
			"file_access",
			{
				action: "read",
				path,
				sizeBytes,
				turnIndex: currentTurn,
			},
			{
				timestamp: new Date().toISOString(),
				sessionId: telemetry.sessionId,
				workspace: process.cwd(),
			},
		);
	});
}
