import * as crypto from "node:crypto";
import * as fs from "node:fs";
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
		statsDir: join(HOME, "neelopedia", "stats", "pi", "post-write-linter"),
		sessionId,
		cwd: process.cwd(),
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
		const ts = new Date().toISOString();

		try {
			const result = checkFile(filePath);
			if (!result.success && result.output) {
				statsLog.logResult({
					ts,
					filePath,
					language,
					status: "error",
					output: result.output,
					parentModel: lastModel ?? "unknown",
					thinkingLevel: lastThinking,
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
			statsLog.logResult({
				ts,
				filePath,
				language,
				status: "success",
				parentModel: lastModel ?? "unknown",
				thinkingLevel: lastThinking,
			});
		} catch {
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
}
