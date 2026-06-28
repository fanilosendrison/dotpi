/**
 * Pi extension — blocks writes directly to dotpi/dotagents/dotclaude
 * instead of through their respective symlink entry points.
 *
 * Enforces the rule: always write through the ~/.agent or ~/.claude
 * symlink, never directly into the Projects/ repo directory.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";

const GUARDED: Array<{ real: string; gateway: string; label: string }> = [
  {
    real: "/Users/famillesendrison/Developper/Projects/dotpi",
    gateway: "/Users/famillesendrison/.pi/agent",
    label: "dotpi",
  },
  {
    real: "/Users/famillesendrison/Developper/Projects/dotagents",
    gateway: "/Users/famillesendrison/.agents",
    label: "dotagents",
  },
  {
    real: "/Users/famillesendrison/Developper/Projects/dotclaude",
    gateway: "/Users/famillesendrison/.claude",
    label: "dotclaude",
  },
];

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
      // File doesn't exist yet — walk up to first existing ancestor
      let ancestor = givenPath.replace(/\/[^/]+$/, "") || "/";
      while (ancestor && !existsSync(ancestor)) {
        ancestor = ancestor.replace(/\/[^/]+$/, "") || "/";
      }
      if (!ancestor || !existsSync(ancestor)) return;
      const rel = givenPath.slice(ancestor.length + 1);
      real = realpathSync(ancestor) + "/" + rel;
    }

    for (const g of GUARDED) {
      if (real.startsWith(g.real + "/") || real === g.real) {
        if (!givenPath.startsWith(g.gateway)) {
          return {
            block: true,
            reason:
              `Write through ${g.gateway}, not directly to ${g.label}/.\n` +
              `  Given:  ${givenPath}\n` +
              `  Use:    ${givenPath.replace(g.real, g.gateway)}`,
          };
        }
      }
    }
  });
}
