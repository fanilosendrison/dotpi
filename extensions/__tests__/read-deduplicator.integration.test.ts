import { describe, expect, test } from "bun:test";
import { createReadTracker } from "../../../dotagents/agent-hooks/read-deduplicator/src/core/read-tracker";

/**
 * Integration tests: simulate the full event sequence the extension
 * orchestrates (tool_call → tool_result → before_provider_request → tool_call).
 */
/** Extract text from a messages payload (mirrors the extension logic). */
function extractPayloadText(messages: any[]): string {
  return messages
    .flatMap((m: any) =>
      Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text)
        : [typeof m.content === "string" ? m.content : ""],
    )
    .join("\n");
}

describe("read-deduplicator / decision chain", () => {
  test("blocks re-read when file unchanged and still in payload", () => {
    const t = createReadTracker();

    // Turn 5: agent reads file, tool_result captures content
    t.track("/tmp/file.md", "fp-1", 5, "Line 1\nLine 2");

    // Turn 6: before_provider_request — file still in payload
    const messages = [
      { role: "user", content: [{ type: "text", text: "Line 1\nLine 2 rest of prompt" }] },
    ];
    const payloadText = extractPayloadText(messages);
    for (const [path, entry] of t.entries()) {
      t.setStillInContext(path, payloadText.includes(entry.injectedText));
    }

    // Turn 6: agent tries to read same file — should be blocked
    const entry = t.get("/tmp/file.md");
    expect(entry!.stillInContext).toBe(true);
    expect(entry!.fingerprint).toBe("fp-1");
  });

  test("allows re-read when file was truncated from payload", () => {
    const t = createReadTracker();

    // Turn 2: agent reads file
    t.track("/tmp/file.md", "fp-1", 2, "Original content here");

    // Turn 50: before_provider_request — content no longer in payload
    const messages = [
      { role: "user", content: [{ type: "text", text: "completely different prompt" }] },
    ];
    const payloadText = extractPayloadText(messages);
    for (const [path, entry] of t.entries()) {
      t.setStillInContext(path, payloadText.includes(entry.injectedText));
    }

    const entry = t.get("/tmp/file.md");
    expect(entry!.stillInContext).toBe(false);
  });

  test("allows re-read when file was modified", () => {
    const t = createReadTracker();

    // First read
    t.track("/tmp/file.md", "fp-v1", 3, "version 1");

    // File modified on disk — fingerprint changed
    const entry = t.get("/tmp/file.md");
    const newFingerprint = "fp-v2";

    // Extension logic: if fingerprint differs from entry.fingerprint → allow
    expect(entry!.fingerprint).not.toBe(newFingerprint);
  });

  test("full cycle: read, block on re-read, allow after truncation", () => {
    const t = createReadTracker();

    // 1. First read at turn 3
    t.track("/tmp/doc.md", "fp-doc", 3, "doc content");

    // 2. before_provider_request at turn 4 — still there
    let msgs = [{ role: "user", content: [{ type: "text", text: "doc content still here" }] }];
    let payloadText = extractPayloadText(msgs);
    for (const [path, entry] of t.entries()) {
      t.setStillInContext(path, payloadText.includes(entry.injectedText));
    }
    expect(t.get("/tmp/doc.md")!.stillInContext).toBe(true);
    // → tool_call would be BLOCKED

    // 3. before_provider_request at turn 50 — truncated
    msgs = [{ role: "user", content: [{ type: "text", text: "something else entirely" }] }];
    payloadText = extractPayloadText(msgs);
    for (const [path, entry] of t.entries()) {
      t.setStillInContext(path, payloadText.includes(entry.injectedText));
    }
    expect(t.get("/tmp/doc.md")!.stillInContext).toBe(false);
    // → tool_call would be ALLOWED

    // 4. After re-read, tracker updated
    t.track("/tmp/doc.md", "fp-doc", 50, "doc content");
    expect(t.get("/tmp/doc.md")!.turn).toBe(50);
    expect(t.get("/tmp/doc.md")!.stillInContext).toBe(true);
  });

  test("multiple files tracked independently through payload checks", () => {
    const t = createReadTracker();

    t.track("/tmp/a.md", "fp-a", 1, "content AAAA");
    t.track("/tmp/b.md", "fp-b", 2, "content BBBB");

    // Payload contains A but not B (B was truncated)
    const msgs = [{ role: "user", content: [{ type: "text", text: "content AAAA is here" }] }];
    const payloadText = extractPayloadText(msgs);
    for (const [path, entry] of t.entries()) {
      t.setStillInContext(path, payloadText.includes(entry.injectedText));
    }

    expect(t.get("/tmp/a.md")!.stillInContext).toBe(true);  // still there → block
    expect(t.get("/tmp/b.md")!.stillInContext).toBe(false); // truncated → allow
  });
});
