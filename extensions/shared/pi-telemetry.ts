/**
 * Shared Pi telemetry — wires model/thinking capture hooks and provides
 * a ready-to-use EventSink for any Pi extension.
 *
 * Usage:
 *   const telemetry = createPiTelemetry(pi, "my-extension");
 *   telemetry.append("event_type", details);
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEventSink } from "../../../telemetry-tools/event-sink/src/index.ts";
import type {
	AppendOverrides,
	EventSink,
} from "../../../telemetry-tools/event-sink/src/index.ts";

export interface PiTelemetryContextDetails {
	parentModel: string;
	thinkingLevel: string;
}

export interface PiTelemetry {
	/** The underlying EventSink — call sink.append() directly. */
	readonly sink: EventSink;
	/** Current model name (updated automatically by hooks). */
	readonly model: string;
	/** Current thinking level (updated automatically by hooks). */
	readonly thinking: string;
	/** Session UUID (stable for the lifetime of this extension instance). */
	readonly sessionId: string;
	/** Common detail fields added to extension telemetry payloads. */
	contextDetails(): PiTelemetryContextDetails;
	/** Append an event with current model/thinking details and a fresh timestamp. */
	append(
		eventType: string,
		details: Record<string, unknown>,
		overrides?: AppendOverrides,
	): void;
}

export interface PiTelemetryOptions {
	/** Override the stats directory (e.g. from an env var). */
	statsDir?: string;
}

function readDefaultThinking(): string {
	try {
		const p = join(homedir(), ".pi", "agent", "settings.json");
		if (fs.existsSync(p)) {
			return (
				JSON.parse(fs.readFileSync(p, "utf-8")).defaultThinkingLevel ??
				"unknown"
			);
		}
	} catch {}
	return "unknown";
}

export function createPiTelemetry(
	pi: ExtensionAPI,
	namespace: string,
	options?: PiTelemetryOptions,
): PiTelemetry {
	const sessionId = crypto.randomUUID();
	let lastModel = "unknown";
	let lastThinking: string = readDefaultThinking();

	pi.on("before_provider_request", async (event) => {
		const model = (event.payload as Record<string, unknown>)?.model;
		if (typeof model === "string") {
			lastModel = model;
		}
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
	});

	const statsDir =
		options?.statsDir ??
		(process.env.PI_TELEMETRY_BASE_DIR
			? join(process.env.PI_TELEMETRY_BASE_DIR, namespace)
			: join(homedir(), "neelopedia", "stats", "pi", namespace));

	const sink = createEventSink({
		statsDir,
		agent: "pi",
		namespace,
		sessionId,
		workspace: process.cwd(),
	});

	const contextDetails = (): PiTelemetryContextDetails => ({
		parentModel: lastModel,
		thinkingLevel: lastThinking,
	});

	return {
		sink,
		get model() {
			return lastModel;
		},
		get thinking() {
			return lastThinking;
		},
		sessionId,
		contextDetails,
		append(eventType, details, overrides) {
			sink.append(
				eventType,
				{ ...details, ...contextDetails() },
				{ timestamp: new Date().toISOString(), ...overrides },
			);
		},
	};
}
