/**
 * Pi extension — blocks git commits containing secrets, API keys, or tokens.
 *
 * Imports scanDiff from ~/.agents/agent-enforcers/secret-scanner/.
 * No duplicated detection logic.
 *
 * Stats: logs a scan_result event per scan in
 * ~/neelopedia/stats/pi/secret-scanner/events.jsonl.
 */

import { execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
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
		statsDir: join(homedir(), "neelopedia", "stats", "pi", "secret-scanner"),
		sessionId,
		cwd: process.cwd(),
	});

	// ── Scan staged diff on git commit ──────────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!/\bgit\s+commit\b/.test(cmd)) return;

		const ts = new Date().toISOString();

		let diff: string;
		try {
			diff = execSync("git diff --cached", { encoding: "utf-8" });
		} catch {
			statsLog.logResult({
				ts,
				status: "clean",
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
			return;
		}

		if (!diff.trim()) {
			statsLog.logResult({
				ts,
				status: "clean",
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
			return;
		}

		const result = scanDiff(diff);
		if (!result.clean) {
			statsLog.logResult({
				ts,
				status: "blocked",
				findings: result.findings,
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});

			const list = result.findings.map(
				(f) => `${f.name}: ${f.line.slice(0, 80)}`,
			);
			return {
				block: true,
				reason: `Secret(s) detected in staged diff:\n${list.join("\n")}`,
			};
		}

		statsLog.logResult({
			ts,
			status: "clean",
			parentModel: lastModel ?? "unknown",
			thinkingLevel: lastThinking,
		});
	});
}
