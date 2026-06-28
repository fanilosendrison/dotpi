/**
 * Pi extension — blocks writes directly to dotpi/ instead of through ~/.pi/agent/.
 *
 * Enforces the rule: "Always write through ~/.pi/agent/, never directly into dotpi/".
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";

const DOTPI_REAL = "/Users/famillesendrison/Developper/Projects/dotpi";
const AGENT_DIR = "/Users/famillesendrison/.pi/agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) {
      return;
    }

    const givenPath = event.input.file_path;
    if (!givenPath || typeof givenPath !== "string") return;

    // Resolve to real path (follows symlinks)
    let real: string;
    try {
      real = realpathSync(givenPath);
    } catch {
      // File doesn't exist yet — resolve the parent directory
      try {
        const parent = givenPath.replace(/\/[^/]+$/, "") || "/";
        real = realpathSync(parent) + "/" + givenPath.split("/").pop();
      } catch {
        // Can't resolve at all, allow
        return;
      }
    }

    // Block if writing inside dotpi/ but NOT through ~/.pi/agent/
    if (real.startsWith(DOTPI_REAL + "/") || real === DOTPI_REAL) {
      if (!givenPath.startsWith(AGENT_DIR)) {
        return {
          block: true,
          reason:
            `Write through ~/.pi/agent/, not directly to dotpi/.\n` +
            `  Given:  ${givenPath}\n` +
            `  Use:    ${givenPath.replace(DOTPI_REAL, AGENT_DIR)}`,
        };
      }
    }
  });
}
