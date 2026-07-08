import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";

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
	const telemetry = createPiTelemetry(pi, "post-write-linter");

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
				const outputTruncated =
					result.output.length <= 500
						? result.output
						: result.output.slice(0, 500) + "…";
				telemetry.sink.append(
					"lint_result",
					{
						filePath,
						language,
						status: "error",
						output: outputTruncated,
						parentModel: telemetry.model,
						thinkingLevel: telemetry.thinking,
					},
					{ timestamp: ts },
				);
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
			telemetry.sink.append(
				"lint_result",
				{
					filePath,
					language,
					status: "success",
					parentModel: telemetry.model,
					thinkingLevel: telemetry.thinking,
				},
				{ timestamp: ts },
			);
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

