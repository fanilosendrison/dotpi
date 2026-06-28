/**
 * Pi extension — deduplicates `read` tool calls by tracking which files
 * have already been injected into the context in this session.
 *
 * Blocks re-reads when: fingerprint matches AND file still in provider payload.
 * Allows re-reads when: first read, file modified, or content truncated from payload.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, isReadToolResult } from "@earendil-works/pi-coding-agent";
import { createReadTracker } from "../../dotagents/agent-hooks/read-deduplicator/src/core/read-tracker";
import { statSync } from "node:fs";

export default function (pi: ExtensionAPI) {
  const tracker = createReadTracker();
  let currentTurn = 0;

  // Track current turn number
  pi.on("turn_start", async (event) => {
    currentTurn = event.turnIndex;
  });

  // Before each provider request, update stillInContext for all tracked files
  pi.on("before_provider_request", async (event) => {
    // Extract all text from the payload messages (avoid JSON.stringify which escapes newlines)
    const messages = (event.payload as any)?.messages ?? [];
    const payloadText = messages
      .flatMap((m: any) =>
        Array.isArray(m.content)
          ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text)
          : [typeof m.content === "string" ? m.content : ""],
      )
      .join("\n");
    for (const [path, entry] of tracker.entries()) {
      tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
    }
  });

  // Guard read calls
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("read", event)) return;

    const path = event.input.path;
    if (!path || typeof path !== "string") return;

    let fingerprint: string;
    try {
      const stat = statSync(path);
      fingerprint = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return; // file doesn't exist yet — let read handle the error
    }

    const entry = tracker.get(path);

    // First read — always allow
    if (!entry) return;

    // File modified — allow (tracker will be updated in tool_result)
    if (entry.fingerprint !== fingerprint) return;

    // Same fingerprint, still in context — block
    if (entry.stillInContext) {
      return {
        block: true,
        reason: `(already in context, turn ${entry.turn})`,
      };
    }

    // Same fingerprint, but truncated from context — allow
  });

  // Capture injected text after successful reads
  pi.on("tool_result", async (event) => {
    if (!isReadToolResult(event)) return;

    const path = event.input.path as string;
    if (!path || typeof path !== "string") return;

    const textContent = event.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (!textContent) return;

    let fingerprint: string;
    try {
      const stat = statSync(path);
      fingerprint = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return;
    }

    tracker.track(path, fingerprint, currentTurn, textContent);
  });
}
