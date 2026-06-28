import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const AGENTS_PATH = `${homedir()}/.agents/AGENTS.md`;

let cached: string | null = null;

export default function (pi: ExtensionAPI) {
  // Reload cache when user explicitly reloads extensions
  pi.on("session_start", () => {
    cached = null;
  });

  pi.on("before_agent_start", async (event) => {
    if (cached === null) {
      if (existsSync(AGENTS_PATH)) {
        cached = readFileSync(AGENTS_PATH, "utf-8").trim();
      } else {
        cached = ""; // don't retry
      }
    }

    if (!cached) return;

    const xmlBlock =
      `<project_instructions path="${AGENTS_PATH}">\n${cached}\n</project_instructions>`;

    // Inject inside <project_context>, or create it
    const ctxTag = "<project_context>";
    if (event.systemPrompt.includes(ctxTag)) {
      // Insert right after the opening tag (before any existing instructions)
      event.systemPrompt = event.systemPrompt.replace(
        ctxTag,
        `${ctxTag}\n\n${xmlBlock}`,
      );
    } else {
      // No project_context yet — append before current date section
      event.systemPrompt += `\n\n${ctxTag}\n\n${xmlBlock}\n</project_context>\n`;
    }
  });
}
