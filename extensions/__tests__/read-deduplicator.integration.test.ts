import { describe, expect, test } from "bun:test";
import {
	createReadTracker,
	type TrackEntry,
} from "../read-deduplicator-internals/read-tracker";

/**
 * Integration tests for the read-deduplicator decision chain.
 *
 * Tests the BEHAVIOR (should the read be blocked?), not the internal state.
 * The tracker's fields (stillInContext, fingerprint, turn) are implementation
 * details — the contract is the decision.
 */

// ── Test helpers ─────────────────────────────────────────────────────────

/** The decision the extension makes in its tool_call handler. */
function shouldBlock(
	tracker: ReturnType<typeof createReadTracker>,
	path: string,
	fingerprint: string,
): boolean {
	const entry = tracker.get(path);
	if (!entry) return false; // first read → allow
	if (entry.fingerprint !== fingerprint) return false; // modified → allow
	return entry.stillInContext; // same, in context → block; same, truncated → allow
}

/**
 * Simulate what before_provider_request does: for every tracked file,
 * check if its injectedText appears in the payload and update stillInContext.
 */
function updateStillInContext(
	tracker: ReturnType<typeof createReadTracker>,
	payloadMessages: { role: string; content: string }[],
): void {
	const payloadText = payloadMessages.map((m) => m.content).join("\n");
	for (const [path, entry] of tracker.entries()) {
		tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
	}
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("read-deduplicator / decision chain", () => {
	test("first read is always allowed", () => {
		const t = createReadTracker();
		expect(shouldBlock(t, "/tmp/new.md", "fp-new")).toBe(false);
	});

	test("re-read with same fingerprint while in payload → blocked", () => {
		const t = createReadTracker();

		// Agent reads file, content captured
		t.track("/tmp/a.md", "fp-a", 5, "the file content");

		// Next turn: content still in payload
		updateStillInContext(t, [
			{ role: "user", content: "some intro. the file content is still here." },
		]);

		// Agent tries to re-read → blocked
		expect(shouldBlock(t, "/tmp/a.md", "fp-a")).toBe(true);
	});

	test("re-read with same fingerprint but content truncated → allowed", () => {
		const t = createReadTracker();

		t.track("/tmp/b.md", "fp-b", 2, "old content that is gone now");

		// Many turns later: content no longer in payload
		updateStillInContext(t, [
			{ role: "user", content: "completely different conversation now" },
		]);

		// Agent tries to re-read → allowed (need to reload)
		expect(shouldBlock(t, "/tmp/b.md", "fp-b")).toBe(false);
	});

	test("re-read after file was modified → allowed", () => {
		const t = createReadTracker();

		t.track("/tmp/c.md", "fp-v1", 3, "version 1 content");
		updateStillInContext(t, [
			{ role: "user", content: "version 1 content is here" },
		]);

		// File was edited on disk → different fingerprint
		// (stillInContext is irrelevant when fingerprint differs)
		expect(shouldBlock(t, "/tmp/c.md", "fp-v2")).toBe(false);
	});

	test("full cycle: read → block on re-read → allow after truncation → re-track", () => {
		const t = createReadTracker();

		// Before first read: entry doesn't exist → not blocked
		expect(shouldBlock(t, "/tmp/doc.md", "fp-doc")).toBe(false);

		// Turn 3: agent reads file, tool_result captures it
		t.track("/tmp/doc.md", "fp-doc", 3, "doc content");

		// Turn 4: still in payload → re-read blocked
		updateStillInContext(t, [
			{ role: "user", content: "doc content still here" },
		]);
		expect(shouldBlock(t, "/tmp/doc.md", "fp-doc")).toBe(true);

		// Turn 50: truncated from payload → re-read allowed
		updateStillInContext(t, [
			{ role: "user", content: "something else entirely" },
		]);
		expect(shouldBlock(t, "/tmp/doc.md", "fp-doc")).toBe(false);

		// Agent re-reads, tracker updated
		t.track("/tmp/doc.md", "fp-doc", 50, "doc content");
		updateStillInContext(t, [
			{ role: "user", content: "doc content reloaded" },
		]);
		expect(shouldBlock(t, "/tmp/doc.md", "fp-doc")).toBe(true);
	});

	test("multiple files tracked independently", () => {
		const t = createReadTracker();

		t.track("/tmp/x.md", "fp-x", 1, "content XXXX");
		t.track("/tmp/y.md", "fp-y", 2, "content YYYY");

		// Payload still contains X but not Y
		updateStillInContext(t, [
			{ role: "user", content: "content XXXX is here but YYYY is gone" },
		]);

		expect(shouldBlock(t, "/tmp/x.md", "fp-x")).toBe(true); // X → blocked
		expect(shouldBlock(t, "/tmp/y.md", "fp-y")).toBe(false); // Y → allowed (truncated)
	});
});
