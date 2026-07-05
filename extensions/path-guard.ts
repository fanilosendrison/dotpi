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

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const CORE_PATH = join(
	homedir(),
	".agents/agent-enforcers/path-guard/src/core/path-guard",
);
const { checkPath, rewriteBashCommand, extractBashPaths } = require(CORE_PATH);

import { createStatsLog } from "./path-guard-internals/stats-log";

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
	const gateway = expanded.match(/\/\.([a-z]+)\/[^\/]/);
	if (gateway) return "dot" + gateway[1];
	return null;
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

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	let lastModel: string | undefined;
	let lastThinking: string = readDefaultThinking();

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
	});

	const statsLog = createStatsLog({
		statsDir: join(homedir(), "neelopedia", "stats", "pi", "path-guard"),
		sessionId,
		cwd: process.cwd(),
	});

	// ── Guard Write and Edit ─────────────────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (
			!isToolCallEventType("write", event) &&
			!isToolCallEventType("edit", event)
		) {
			return;
		}

		const givenPath =
			event.input.file_path ?? event.input.path ?? event.input.TargetFile;
		if (!givenPath || typeof givenPath !== "string") return;

		const isDot = targetsDotRepo(givenPath);
		const result = checkPath(givenPath);
		if (!isDot) return;

		const toolType = isToolCallEventType("write", event)
			? ("write" as const)
			: ("edit" as const);
		const repo = extractRepo(givenPath) || "unknown";

		if (!result.allowed && result.rewrittenPath) {
			statsLog.logAccess({
				ts: new Date().toISOString(),
				toolType,
				repo,
				action: "redirected",
				givenPath,
				rewrittenTo: result.rewrittenPath,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
			if ("file_path" in event.input)
				event.input.file_path = result.rewrittenPath;
			if ("path" in event.input) event.input.path = result.rewrittenPath;
			if ("TargetFile" in event.input)
				event.input.TargetFile = result.rewrittenPath;
		} else {
			statsLog.logAccess({
				ts: new Date().toISOString(),
				toolType,
				repo,
				action: "correct",
				givenPath,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
		}
	});

	// ── Guard Bash commands that write to dot* repos ─────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (!command || typeof command !== "string") return;

		const paths = extractBashPaths(command);
		const dotPaths = paths.filter((p) => targetsDotRepo(p));

		const hasGateway = dotPaths.length > 0 || /\/\.(?:pi\/agent|agents|[a-z]+)(?:\/|\s|$)/.test(command);
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
			statsLog.logAccess({
				ts: new Date().toISOString(),
				toolType: "bash",
				repo,
				action: "redirected",
				givenPath,
				rewrittenTo: result.newCommand,
				originalCmd: command,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
		} else {
			statsLog.logAccess({
				ts: new Date().toISOString(),
				toolType: "bash",
				repo,
				action: "correct",
				givenPath: dotPaths[0],
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
		}
	});
}
