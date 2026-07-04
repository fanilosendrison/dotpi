import crypto from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createStatsLog } from "./post-write-linter-internals/stats-log";

const HOME = process.env.HOME || homedir();
const linterPath = join(
	HOME,
	".agents/agent-enforcers/post-write-linter/src/core/linter",
);
const { checkFile } = require(linterPath);

function extractLanguage(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() || "";
	return ext;
}

export default function (pi: ExtensionAPI) {
	const sessionId = crypto.randomUUID();
	const statsDir = join(HOME, "neelopedia", "stats", "pi", "post-write-linter");
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

	// ── Lint after write/edit ───────────────────────────────────────────────

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return;
		}

		const filePath =
			event.input?.file_path || event.input?.path || event.input?.TargetFile;
		if (!filePath || typeof filePath !== "string") {
			return;
		}

		const language = extractLanguage(filePath);

		try {
			const result = checkFile(filePath);
			if (!result.success && result.output) {
				statsLog.addLintError({
					ts: new Date().toISOString(),
					filePath,
					language,
					output: result.output,
				});
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Biome linter errors in ${filePath}:\n\n${result.output}`,
						},
					],
				};
			}
			// File passed linting — count it
			statsLog.incClean();
		} catch {
			// Internal linter errors are not logged (per spec)
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Internal Linter Error running linter on ${filePath}`,
					},
				],
			};
		}
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
