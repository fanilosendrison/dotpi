/**
 * Pi extension — validates git commit messages against Conventional Commits 1.0.0.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/commit-msg-validator/.
 * No duplicated validation logic.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const VALIDATOR_PATH = join(
	homedir(),
	".agents/agent-enforcers/commit-msg-validator/src/core/validator",
);
const { isGitCommit, extractCommitMessage, validateCommitMessage } =
	require(VALIDATOR_PATH);

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!isGitCommit(cmd)) return;

		const message = extractCommitMessage(cmd);
		if (!message) return;

		const result = validateCommitMessage(message);
		if (!result.valid) {
			return {
				block: true,
				reason: `Commit message invalide:\n- ${result.errors.join("\n- ")}`,
			};
		}
	});
}
