/**
 * Pi extension — blocks direct git commit unless message follows Conventional Commits
 * AND the commit is followed by a push.
 *
 * Imports the shared validator from ~/.agents/agent-hooks/git-commits-push-enforcer/.
 * Forces the agent to use /git-commits-push.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  isGitCommit,
  extractMessage,
  isValidCC,
  hasPush,
} from "../../../dotagents/agent-hooks/git-commits-push-enforcer/src/core/validator";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!isGitCommit(event.input.command)) return;

    const msg = extractMessage(event.input.command);
    if (msg === null) return;

    if (!isValidCC(msg)) {
      return {
        block: true,
        reason:
          "Use /git-commits-push to generate a Conventional Commits message.\n" +
          `Got: "${msg.slice(0, 60)}" — expected: <type>(<scope>): <description>`,
      };
    }

    if (!hasPush(event.input.command)) {
      return {
        block: true,
        reason:
          "Always push after commit. Use: git commit ... && git push\n" +
          "Or invoke /git-commits-push which handles this automatically.",
      };
    }
  });
}
