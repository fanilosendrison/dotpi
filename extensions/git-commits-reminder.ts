/**
 * Pi extension — reminds the agent to use /git-commits-push before committing.
 *
 * Mirrors ~/.agents/agent-hooks/git-commits-skill-reminder/
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const GIT_COMMIT = /\bgit\s+commit\b/;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!GIT_COMMIT.test(event.input.command)) return;

    // Don't block — just inject a reminder. The commit-validator extension
    // will enforce message quality regardless.
    return {
      message: {
        customType: "git-commits-reminder",
        content:
          "⚠️  /git-commits-push should have been invoked before this commit. " +
          "If it wasn't, cancel this commit and invoke /git-commits-push first. " +
          "It will generate a Conventional Commits message AND auto-push.",
        display: true,
      },
    };
  });
}
