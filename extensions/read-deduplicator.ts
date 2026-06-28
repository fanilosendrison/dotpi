/**
 * Pi extension — deduplicates `read` tool calls by tracking which files
 * have already been injected into the context in this session.
 *
 * Blocks re-reads of the same file (same mtime+size) within a turn window.
 * After TURN_THRESHOLD turns, assumes the file may have been truncated and
 * allows the re-read.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createReadTracker } from "../../dotagents/agent-hooks/read-deduplicator/src/core/read-tracker";
import { statSync } from "node:fs";

/** Maximum turn distance before assuming a file has been truncated from context. */
const TURN_THRESHOLD = 50;

export default function (pi: ExtensionAPI) {
  const tracker = createReadTracker();
  let currentTurn = 0;

  // Track current turn number
  pi.on("turn_start", async (event) => {
    currentTurn = event.turnIndex;
  });

  // Guard read calls
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("read", event)) return;

    const path = event.input.file_path;
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
    if (!entry) {
      tracker.track(path, fingerprint, currentTurn);
      return;
    }

    // File modified — allow and update
    if (entry.fingerprint !== fingerprint) {
      tracker.track(path, fingerprint, currentTurn);
      return;
    }

    // Same fingerprint, within threshold — block
    if (currentTurn - entry.turn < TURN_THRESHOLD) {
      return {
        block: true,
        reason: `(already in context, turn ${entry.turn})`,
      };
    }

    // Same fingerprint, but beyond threshold — allow (may be truncated)
    tracker.track(path, fingerprint, currentTurn);
  });
}
