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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { checkPath, rewriteBashCommand, extractBashPaths } from "../../dotagents/agent-enforcers/path-guard/src/core/path-guard";

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

	pi.on("tool_call", async (event) => {
		if (
			!isToolCallEventType("write", event) &&
			!isToolCallEventType("edit", event)
		) {
			return;
		}

		const inputAny = event.input as Record<string, any>;
		const givenPath =
			inputAny.file_path ?? inputAny.path ?? inputAny.TargetFile;
		if (!givenPath || typeof givenPath !== "string") return;

		const isDot = targetsDotRepo(givenPath);
		const result = checkPath(givenPath);
		if (!isDot) return;

		const toolType = isToolCallEventType("write", event)
			? ("write" as const)
			: ("edit" as const);
		const repo = extractRepo(givenPath) || "unknown";

		if (!result.allowed && result.rewrittenPath) {
			telemetry.sink.append(
				"path_access",
				buildDetails({
					toolType,
					repo,
					action: "redirected",
					givenPath,
					rewrittenTo: result.rewrittenPath,
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				}),
				{ timestamp: new Date().toISOString() },
			);
			if ("file_path" in event.input)
				inputAny.file_path = result.rewrittenPath;
			if ("path" in event.input) inputAny.path = result.rewrittenPath;
			if ("TargetFile" in event.input)
				inputAny.TargetFile = result.rewrittenPath;
		} else {
			telemetry.sink.append(
				"path_access",
				buildDetails({
					toolType,
					repo,
					action: "correct",
					givenPath,
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				}),
				{ timestamp: new Date().toISOString() },
			);
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
