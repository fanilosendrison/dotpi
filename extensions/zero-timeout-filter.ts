/**
 * Pi extension — strips external timeout from git-commits-push skill invocations.
 *
 * The skill manages its own deadlines (600s/delegation). If the agent
 * sets a short shell timeout, it orphans the run. This extension
 * silently removes the timeout before the command executes.
 *
 * Stats: logs every stripped timeout to
 * ~/neelopedia/stats/pi/zero-timeout-filter/events.jsonl
 * for computing the ratio: stripped / git-commits-push invocations.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createStatsLog } from "./zero-timeout-filter-internals/stats-log";

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();

	// Read default thinking level from settings as fallback
	const defaultThinking: string = (() => {
		try {
			const path = join(homedir(), ".pi", "agent", "settings.json");
			if (fs.existsSync(path)) {
				const raw = fs.readFileSync(path, "utf-8");
				return JSON.parse(raw).defaultThinkingLevel ?? "unknown";
			}
		} catch {}
		return "unknown";
	})();
	let lastModel: string | undefined;
	let lastThinking: string | undefined = defaultThinking;
	let statsLog: ReturnType<typeof createStatsLog> | undefined;

	function ensureStatsLog() {
		if (!statsLog) {
			const dir =
				process.env.ZERO_TIMEOUT_FILTER_STATS_DIR ??
				join(homedir(), "neelopedia", "stats", "pi", "zero-timeout-filter");
			statsLog = createStatsLog({ statsDir: dir });
		}
		return statsLog;
	}

	// ── Capture model + thinking level ──────────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		lastModel = (payload?.model as string) ?? lastModel;
	});

	pi.on("thinking_level_select", async (event) => {
		lastThinking = event.level;
	});

	// ── Strip timeout on skill invocation ───────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!cmd.includes("bun run start")) return;
		if (!cmd.includes(".agents/skills/git-commits-push")) return;

		const originalTimeout = event.input.timeout;

		// Strip the timeout regardless — skill manages its own
		delete event.input.timeout;

		// Log only if there was actually a timeout to strip
		if (originalTimeout === undefined) return;

		ensureStatsLog().logTimeoutStripped({
			ts: new Date().toISOString(),
			originalTimeout,
			parentModel: lastModel ?? "unknown",
			thinkingLevel: lastThinking ?? "unknown",
			sessionId,
			workspace: process.cwd(),
			toolCallId: event.toolCallId,
		});
	});
}
