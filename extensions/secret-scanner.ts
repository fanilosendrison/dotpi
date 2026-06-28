/**
 * Pi extension — blocks git commits containing secrets, API keys, or tokens.
 *
 * Imports scanDiff from ~/.agents/agent-hooks/secret-scanner/.
 * No duplicated detection logic.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { scanDiff } from "../../dotagents/agent-hooks/secret-scanner/src/core/scanner";
import { execSync } from "node:child_process";

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
      const list = result.findings.map((f) => `${f.name}: ${f.line.slice(0, 80)}`);
      return {
        block: true,
        reason: `Secret(s) detected in staged diff:\n${list.join("\n")}`,
      };
    }
  });
}
