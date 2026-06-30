/**
 * Pi extension — blocks writes directly to any dot* repo under Projects/
 * instead of through its ~/. prefix symlink.
 *
 * Covers Write, Edit, and Bash tool calls.
 * Uses shared logic from ~/.agents/agent-enforcers/shared/core/path-guard.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { checkPath, rewriteBashCommand } from "../../../.agents/agent-enforcers/path-guard/src/core/path-guard";

export default function (pi: ExtensionAPI) {
  // Guard Write and Edit
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) {
      return;
    }

    const givenPath = event.input.file_path ?? event.input.path ?? event.input.TargetFile;
    if (!givenPath || typeof givenPath !== "string") return;

    const result = checkPath(givenPath);
    if (!result.allowed && result.rewrittenPath) {
      if ("file_path" in event.input) event.input.file_path = result.rewrittenPath;
      if ("path" in event.input) event.input.path = result.rewrittenPath;
      if ("TargetFile" in event.input) event.input.TargetFile = result.rewrittenPath;
    }
  });

  // Guard Bash commands that write to dot* repos
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const command = event.input.command;
    if (!command || typeof command !== "string") return;

    const result = rewriteBashCommand(command);
    if (result.rewritten) {
      event.input.command = result.newCommand;
    }
  });
}
