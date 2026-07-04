/**
 * Pi extension — blocks git commits containing secrets, API keys, or tokens.
 *
 * Imports scanDiff from ~/.agents/agent-enforcers/secret-scanner/.
 * No duplicated detection logic.
 */

import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const SCANNER_PATH = join(
	homedir(),
	".agents/agent-enforcers/secret-scanner/src/core/scanner",
);
const { scanDiff } = require(SCANNER_PATH);

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!/\bgit\s+commit\b/.test(cmd)) return;

		let diff: string;
		try {
			diff = execSync("git diff --cached", { encoding: "utf-8" });
		} catch {
			return;
		}

		if (!diff.trim()) return;

		const result = scanDiff(diff);
		if (!result.clean) {
			const list = result.findings.map(
				(f) => `${f.name}: ${f.line.slice(0, 80)}`,
			);
			return {
				block: true,
				reason: `Secret(s) detected in staged diff:\n${list.join("\n")}`,
			};
		}
	});
}
