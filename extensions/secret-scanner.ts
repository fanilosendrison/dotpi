/**
 * Pi extension — blocks git commits containing secrets, API keys, or tokens.
 *
 * Imports scanDiff from ~/.agents/agent-enforcers/secret-scanner/.
 * No duplicated detection logic.
 *
 * Stats logging: counts blocked/clean commits per session/model
 * in ~/neelopedia/stats/pi/secret-scanner/events.jsonl.
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const SCANNER_PATH = join(
	homedir(),
	".agents/agent-enforcers/secret-scanner/src/core/scanner",
);
const { scanDiff } = require(SCANNER_PATH);

import { createStatsLog } from "./secret-scanner-internals/stats-log";

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	const statsDir = join(
		homedir(),
		"neelopedia",
		"stats",
		"pi",
		"secret-scanner",
	);
	let lastModel: string | undefined;

	const statsLog = createStatsLog({
		statsDir,
		sessionId,
		cwd: process.cwd(),
	});

	// ── Capture model ───────────────────────────────────────────────────────

	pi.on("before_provider_request", async (event) => {
		lastModel = (event.payload as any)?.model;
	});

	// ── Scan staged diff on git commit ──────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!/\bgit\s+commit\b/.test(cmd)) return;

		// Count this as a scan attempt (even if git diff fails)
		statsLog.incTotal();

		let diff: string;
		try {
			diff = execSync("git diff --cached", { encoding: "utf-8" });
		} catch {
			// Not a git repo or no staged changes — count as clean (fail-open)
			statsLog.incClean();
			return;
		}

		if (!diff.trim()) {
			statsLog.incClean();
			return;
		}

		const result = scanDiff(diff);
		if (!result.clean) {
			statsLog.addBlock({
				ts: new Date().toISOString(),
				findings: result.findings,
			});

			const list = result.findings.map(
				(f) => `${f.name}: ${f.line.slice(0, 80)}`,
			);
			return {
				block: true,
				reason: `Secret(s) detected in staged diff:\n${list.join("\n")}`,
			};
		}

		statsLog.incClean();
	});

	// ── Flush session summary at session end ────────────────────────────────

	pi.on("session_shutdown", () => {
		statsLog.flushSummary({
			endTs: new Date().toISOString(),
			model: lastModel,
			totalTurns: 0,
		});
	});
}
