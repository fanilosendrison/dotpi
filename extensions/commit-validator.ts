/**
 * Pi extension — validates git commit messages against Conventional Commits 1.0.0.
 *
 * Imports the shared validator from ~/.agents/agent-hooks/commit-msg-validator/.
 * No duplicated validation logic.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  isGitCommit,
  extractCommitMessage,
  validateCommitMessage,
} from "../../dotagents/agent-hooks/commit-msg-validator/src/core/validator";

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
