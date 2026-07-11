/**
 * Pi extension — blocks writes directly to any dot* repo under Projects/
 * instead of through its ~/. prefix symlink.
 *
 * Covers Write, Edit, and Bash tool calls.
 * Uses shared logic from ~/.agents/agent-enforcers/shared/core/path-guard.
 *
 * Stats: logs a path_access event per dot* access (redirected or correct)
 * in ~/neelopedia/stats/pi/path-guard/events.jsonl.
 */

import type { ExtensionAPI, WriteToolCallEvent, EditToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { onBashToolCall } from "./shared/pi-tool-events";
import {
	collectPathFields,
	replaceExtractedPath,
	type ExtractedPath,
} from "./shared/pi-tool-inputs";
import {
	checkPath,
	rewriteBashCommand,
	extractBashPaths,
	targetsDotRepo,
	extractRepo,
	PATH_FIELDS,
	collectPatchPaths,
} from "../../../.agents/agent-enforcers/path-guard/src/core/path-guard";

// ── Helpers ────────────────────────────────────────────────────────────────

function collectPathsAndFields(input: Record<string, unknown>): ExtractedPath[] {
	return collectPathFields(input, {
		stringFields: PATH_FIELDS,
		arrayFields: ["paths", "files"],
		patchFields: ["patch", "input", "diff"],
		collectPatchPaths,
	});
}

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "path-guard");

	function buildDetails(entry: {
		toolType: "write" | "edit" | "bash";
		repo: string;
		action: "redirected" | "correct";
		givenPath: string;
		rewrittenTo?: string;
		originalCmd?: string;
	}): Record<string, unknown> {
		const d: Record<string, unknown> = {
			toolType: entry.toolType,
			repo: entry.repo,
			action: entry.action,
			givenPath: entry.givenPath,
		};
		if (entry.rewrittenTo) d.rewrittenTo = entry.rewrittenTo;
		if (entry.originalCmd) {
			d.originalCmd =
				entry.originalCmd.length <= 200
					? entry.originalCmd
					: entry.originalCmd.slice(0, 200) + "…";
		}
		return d;
	}

	// ── Guard Write and Edit ─────────────────────────────────────────────────

	/**
	 * Guard a write or edit tool call — extract path, check, rewrite if needed.
	 * Analyzes standard and fallback path fields, path list arrays, and diff/patch contents,
	 * ensuring exactly one telemetry event is logged per tool call.
	 */
	async function guardFileToolCall(
		event: WriteToolCallEvent | EditToolCallEvent,
		toolType: "write" | "edit",
	): Promise<void> {
		const input = event.input as Record<string, unknown>;
		if (!input) return;

		const extracted = collectPathsAndFields(input);
		if (extracted.length === 0) return;

		// Find if there is any blocked path that targets a dot repo
		let firstBlocked: ExtractedPath | null = null;
		let blockedResult: ReturnType<typeof checkPath> | null = null;

		for (const item of extracted) {
			const isDot = targetsDotRepo(item.path);
			if (isDot) {
				const res = checkPath(item.path);
				if (!res.allowed) {
					firstBlocked = item;
					blockedResult = res;
					break;
				}
			}
		}

		if (firstBlocked && blockedResult) {
			const repo = extractRepo(firstBlocked.path) || "unknown";
			const rewrittenTo = blockedResult.rewrittenPath;
			if (!rewrittenTo) return;

			// Perform the rewrite in the event input for all matching instances
			for (const item of extracted) {
				if (item.path === firstBlocked.path) {
					replaceExtractedPath(input, item, rewrittenTo);
				}
			}

			// Log EXACTLY ONE redirected telemetry event
			telemetry.append(
				"path_access",
				buildDetails({
					toolType,
					repo,
					action: "redirected",
					givenPath: firstBlocked.path,
					rewrittenTo,
				}),
			);
			return;
		}

		// If nothing is blocked, check if we need to log a "correct" access
		for (const item of extracted) {
			if (targetsDotRepo(item.path)) {
				const repo = extractRepo(item.path) || "unknown";
				// Log EXACTLY ONE correct telemetry event
				telemetry.append(
					"path_access",
					buildDetails({
						toolType,
						repo,
						action: "correct",
						givenPath: item.path,
					}),
				);
				return; // Log once and done
			}
		}
	}

	pi.on("tool_call", async (event) => {
		if (isToolCallEventType("write", event)) {
			return guardFileToolCall(event, "write");
		}
		if (isToolCallEventType("edit", event)) {
			return guardFileToolCall(event, "edit");
		}
	});

	// ── Guard Bash commands that write to dot* repos ─────────────────────────

	onBashToolCall(pi, async (event, command) => {
		const paths = extractBashPaths(command);
		const dotPaths = paths.filter((p: string) => targetsDotRepo(p));

		const hasGateway =
			dotPaths.length > 0 ||
			/\/\.(?:pi\/agent|agents|[a-z]+)(?:\/|\s|$)/.test(command);
		if (!hasGateway) return;

		// Determine repo from extracted paths or fallback via gateway pattern
		let repo = "unknown";
		let givenPath = "";
		if (dotPaths.length > 0) {
			repo = extractRepo(dotPaths[0]) || "unknown";
			givenPath = dotPaths[0];
		} else {
			// Extract repo name from gateway path (~/.<name>/ → dot<name>)
			const m = command.match(/\/\.([a-z]+)(?:\/|\s|$)/);
			if (m) {
				repo = "dot" + m[1];
				givenPath = "." + m[1] + "/...";
			}
		}

		const result = rewriteBashCommand(command);

		if (result.rewritten) {
			event.input.command = result.newCommand;
			telemetry.append(
				"path_access",
				buildDetails({
					toolType: "bash",
					repo,
					action: "redirected",
					givenPath,
					rewrittenTo: result.newCommand,
					originalCmd: command,
				}),
			);
		} else {
			telemetry.append(
				"path_access",
				buildDetails({
					toolType: "bash",
					repo,
					action: "correct",
					givenPath,
				}),
			);
		}
	});
}
