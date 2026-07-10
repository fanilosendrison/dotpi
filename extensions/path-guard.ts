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

import { homedir } from "node:os";
import type { ExtensionAPI, WriteToolCallEvent, EditToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { checkPath, rewriteBashCommand, extractBashPaths } from "../../../.agents/agent-enforcers/path-guard/src/core/path-guard";

// ── Helpers ────────────────────────────────────────────────────────────────

/** True when the path (absolute or ~/) targets a dot* repo, either directly
 * (~/Developper/Projects/dot*) or via its gateway (~/.pi/agent/, ~/.agents/). */
function targetsDotRepo(givenPath: string): boolean {
	const expanded =
		givenPath === "~" || givenPath.startsWith("~/")
			? homedir() + givenPath.slice(1)
			: givenPath;
	return (
		expanded.includes("/Developper/Projects/dot") ||
		/^dot[a-z]/.test(expanded) ||
		/\/\.(?:pi\/agent|agents|[a-z]+)(?:\/|$|\s)/.test(expanded)
	);
}

/** Extract the dot* repo name from a path, e.g. "dotpi" or null.
 * Handles both direct paths (~/Developper/Projects/dotpi) and gateways
 * (~/.pi/agent/ → dotpi, ~/.agents/ → dotagents, ~/.gravity/ → dotgravity). */
function extractRepo(p: string): string | null {
	const expanded = p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p;
	const direct = expanded.match(/\/Developper\/Projects\/(dot[a-z]+)/);
	if (direct) return direct[1];
	// Known gateways with non-standard names
	if (expanded.includes("/.pi/agent/")) return "dotpi";
	if (expanded.includes("/.agents/")) return "dotagents";
	// Generic gateway: ~/.<name>/ → dot<name>
	const gateway = expanded.match(/\/\.([a-z]+)\/[^/]/);
	if (gateway) return "dot" + gateway[1];
	return null;
}

const PATH_FIELDS = [
	"file_path",
	"path",
	"TargetFile",
	"target_file",
	"filepath",
	"file",
];

interface ExtractedPath {
	field: string;
	type: "string" | "array" | "patch";
	index?: number;
	path: string;
}

function collectPatchPaths(patchText: string): string[] {
	const paths = new Set<string>();
	for (const line of patchText.split(/\r?\n/)) {
		const explicitFile = line.match(
			/^\*\*\* (?:Add|Update|Delete) File: (.+)$/,
		);
		if (explicitFile?.[1]) {
			paths.add(explicitFile[1].trim());
			continue;
		}

		const movedFile = line.match(/^\*\*\* Move to: (.+)$/);
		if (movedFile?.[1]) {
			paths.add(movedFile[1].trim());
			continue;
		}

		const diffTarget = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (diffTarget?.[1]) {
			paths.add(diffTarget[1].trim());
		}
	}
	return [...paths];
}

function collectPathsAndFields(input: any): ExtractedPath[] {
	const results: ExtractedPath[] = [];

	// 1. Single string fields
	for (const field of PATH_FIELDS) {
		const val = input[field];
		if (typeof val === "string" && val.length > 0) {
			results.push({ field, type: "string", path: val });
		}
	}

	// 2. Arrays of path strings
	const listFields = ["paths", "files"];
	for (const field of listFields) {
		const list = input[field];
		if (Array.isArray(list)) {
			for (let i = 0; i < list.length; i++) {
				const val = list[i];
				if (typeof val === "string" && val.length > 0) {
					results.push({ field, type: "array", index: i, path: val });
				}
			}
		}
	}

	// 3. Patch fields
	for (const field of ["patch", "input", "diff"]) {
		const patchText = input[field];
		if (typeof patchText === "string" && patchText.length > 0) {
			const extracted = collectPatchPaths(patchText);
			for (const val of extracted) {
				results.push({ field, type: "patch", path: val });
			}
		}
	}

	return results;
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
		parentModel: string;
		thinkingLevel: string;
	}): Record<string, unknown> {
		const d: Record<string, unknown> = {
			toolType: entry.toolType,
			repo: entry.repo,
			action: entry.action,
			givenPath: entry.givenPath,
			parentModel: entry.parentModel,
			thinkingLevel: entry.thinkingLevel,
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
		const input = event.input as any;
		if (!input) return;

		const extracted = collectPathsAndFields(input);
		if (extracted.length === 0) return;

		// Find if there is any blocked path that targets a dot repo
		let firstBlocked: ExtractedPath | null = null;
		let blockedResult: any = null;

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

			// Perform the rewrite in the event input for all matching instances
			for (const item of extracted) {
				if (item.path === firstBlocked.path) {
					if (item.type === "string") {
						input[item.field] = rewrittenTo;
					} else if (item.type === "array" && typeof item.index === "number") {
						input[item.field][item.index] = rewrittenTo;
					} else if (item.type === "patch") {
						input[item.field] = input[item.field].split(item.path).join(rewrittenTo);
					}
				}
			}

			// Log EXACTLY ONE redirected telemetry event
			telemetry.sink.append(
				"path_access",
				buildDetails({
					toolType,
					repo,
					action: "redirected",
					givenPath: firstBlocked.path,
					rewrittenTo,
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				}),
				{ timestamp: new Date().toISOString() },
			);
			return;
		}

		// If nothing is blocked, check if we need to log a "correct" access
		for (const item of extracted) {
			if (targetsDotRepo(item.path)) {
				const repo = extractRepo(item.path) || "unknown";
				// Log EXACTLY ONE correct telemetry event
				telemetry.sink.append(
					"path_access",
					buildDetails({
						toolType,
						repo,
						action: "correct",
						givenPath: item.path,
						parentModel: telemetry.model,
						thinkingLevel: telemetry.thinking,
					}),
					{ timestamp: new Date().toISOString() },
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

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (!command || typeof command !== "string") return;

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
			telemetry.sink.append(
				"path_access",
				buildDetails({
					toolType: "bash",
					repo,
					action: "redirected",
					givenPath,
					rewrittenTo: result.newCommand,
					originalCmd: command,
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				}),
				{ timestamp: new Date().toISOString() },
			);
		} else {
			telemetry.sink.append(
				"path_access",
				buildDetails({
					toolType: "bash",
					repo,
					action: "correct",
					givenPath: dotPaths[0],
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				}),
				{ timestamp: new Date().toISOString() },
			);
		}
	});
}
