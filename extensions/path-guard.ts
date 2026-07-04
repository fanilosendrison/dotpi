/**
 * Pi extension — blocks writes directly to any dot* repo under Projects/
 * instead of through its ~/. prefix symlink.
 *
 * Covers Write, Edit, and Bash tool calls.
 * Uses shared logic from ~/.agents/agent-enforcers/shared/core/path-guard.
 *
 * Stats logging: counts redirects and correct writes per session/model
 * in ~/neelopedia/stats/pi/path-guard/events.jsonl.
 */

import crypto from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
	checkPath,
	extractBashPaths,
	rewriteBashCommand,
} from "../../../.agents/agent-enforcers/path-guard/src/core/path-guard";
import { createStatsLog } from "./path-guard-internals/stats-log";

// ── Helpers ────────────────────────────────────────────────────────────────

const PROJECTS = join(homedir(), "Developper", "Projects");

/** True when the path (absolute or ~/) is inside a ~/Developper/Projects/dot* repo. */
function targetsDotRepo(givenPath: string): boolean {
	const expanded =
		givenPath === "~" || givenPath.startsWith("~/")
			? homedir() + givenPath.slice(1)
			: givenPath;
	return (
		expanded.includes("/Developper/Projects/dot") || /^dot[a-z]/.test(expanded)
	);
}

/** Extract the dot* repo name from a path, e.g. "dotpi" or null. */
function extractRepo(p: string): string | null {
	const expanded = p === "~" || p.startsWith("~/") ? homedir() + p.slice(1) : p;
	const match = expanded.match(/\/Developper\/Projects\/(dot[a-z]+)/);
	return match ? match[1] : null;
}

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	const statsDir = join(homedir(), "neelopedia", "stats", "pi", "path-guard");
	let lastModel: string | undefined;

	const statsLog = createStatsLog({
		statsDir,
		sessionId,
		cwd: process.cwd(),
	});

	// ── Capture model from provider requests ─────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
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

		if (isDot) {
			if (!result.allowed && result.rewrittenPath) {
				// Redirect — log it
				const toolType = isToolCallEventType("write", event)
					? ("write" as const)
					: ("edit" as const);
				const repo = extractRepo(givenPath) || "unknown";
				statsLog.addRedirect({
					ts: new Date().toISOString(),
					toolType,
					repo,
					givenPath,
					rewrittenTo: result.rewrittenPath,
				});
				// Rewrite the path in the event input
				if ("file_path" in event.input)
					event.input.file_path = result.rewrittenPath;
				if ("path" in event.input) event.input.path = result.rewrittenPath;
				if ("TargetFile" in event.input)
					event.input.TargetFile = result.rewrittenPath;
			} else {
				// Path already correctly addressed via ~/. gateway
				statsLog.incCorrectWrite();
			}
		} else {
			// Not a dot* repo — apply rewrite if needed (existing behaviour)
			if (!result.allowed && result.rewrittenPath) {
				if ("file_path" in event.input)
					event.input.file_path = result.rewrittenPath;
				if ("path" in event.input) event.input.path = result.rewrittenPath;
				if ("TargetFile" in event.input)
					event.input.TargetFile = result.rewrittenPath;
			}
		}
	});

	// ── Guard Bash commands that write to dot* repos ─────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) {
			return;
		}

		const command = event.input.command;
		if (!command || typeof command !== "string") return;

		// Extract paths once to detect dot* targets (avoid calling rewrite
		// twice — rewriteBashCommand calls extractBashPaths internally).
		const paths = extractBashPaths(command);
		const dotPaths = paths.filter((p) => targetsDotRepo(p));

		const result = rewriteBashCommand(command);

		if (result.rewritten) {
			// Apply the rewritten command
			event.input.command = result.newCommand;

			// Log the rewrite if any dot* paths were involved
			if (dotPaths.length > 0) {
				const repo = extractRepo(dotPaths[0]) || "unknown";
				statsLog.addBashRewrite({
					ts: new Date().toISOString(),
					repo,
					originalCmd: command,
					pathsChanged: dotPaths,
					redirectCount: dotPaths.length,
				});
			}
		} else if (dotPaths.length > 0) {
			// Command targets dot* repos but was not rewritten
			// (paths already correct or git-only command)
			statsLog.incCorrectBash();
		}
	});

	// ── Flush session summary once at session end ───────────────────────────
	//
	// On utilise session_shutdown plutôt que agent_end (qui se déclenche à
	// chaque cycle). Les compteurs cumulent sur toute la session et ne sont
	// flushés qu'ici.

	pi.on("session_shutdown", () => {
		statsLog.flushSummary({
			endTs: new Date().toISOString(),
			model: lastModel,
			totalTurns: 0,
		});
	});
}
