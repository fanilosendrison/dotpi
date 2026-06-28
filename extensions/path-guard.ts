/**
 * Pi extension — blocks writes directly to any dot* repo under Projects/
 * instead of through its ~/. prefix symlink.
 *
 * Uses shared logic from ~/.agents/agent-hooks/shared/core/path-guard.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { checkPath } from "../../dotagents/agent-hooks/path-guard/src/core/path-guard";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) {
      return;
    }

    const givenPath = event.input.file_path;
    if (!givenPath || typeof givenPath !== "string") return;

    const result = checkPath(givenPath);
    if (!result.allowed) {
      return { block: true, reason: result.reason };
    }
  });
}
