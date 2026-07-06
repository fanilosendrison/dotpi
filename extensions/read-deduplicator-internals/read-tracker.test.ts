/**
 * Tests for read-deduplicator read-tracker module.
 *
 * Pure in-memory state — no disk I/O required.
 */

import { describe, expect, test } from "bun:test";
import { createReadTracker } from "./read-tracker";

// ── 1. Basic tracking ─────────────────────────────────────────────────

describe("track / get", () => {
	test("returns undefined for untracked path", () => {
		const tracker = createReadTracker();
		expect(tracker.get("/unknown.ts")).toBeUndefined();
	});

	test("stores and retrieves a track entry", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "content a");

		const entry = tracker.get("/a.ts");
		expect(entry).toBeDefined();
		expect(entry!.fingerprint).toBe("fp1");
		expect(entry!.turn).toBe(0);
		expect(entry!.injectedText).toBe("content a");
		expect(entry!.stillInContext).toBe(true);
	});

	test("overwrites existing entry on re-track", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "content a");
		tracker.track("/a.ts", "fp2", 1, "content b");

		const entry = tracker.get("/a.ts");
		expect(entry!.fingerprint).toBe("fp2");
		expect(entry!.turn).toBe(1);
		expect(entry!.injectedText).toBe("content b");
		expect(entry!.stillInContext).toBe(true);
	});

	test("tracks multiple paths independently", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.track("/b.ts", "fp2", 1, "bbb");

		expect(tracker.get("/a.ts")!.fingerprint).toBe("fp1");
		expect(tracker.get("/b.ts")!.fingerprint).toBe("fp2");
	});
});

// ── 2. stillInContext updates ─────────────────────────────────────────

describe("setStillInContext", () => {
	test("marks an entry as still in context", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", true);

		expect(tracker.get("/a.ts")!.stillInContext).toBe(true);
	});

	test("marks an entry as no longer in context", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", false);

		expect(tracker.get("/a.ts")!.stillInContext).toBe(false);
	});

	test("is no-op for untracked path", () => {
		const tracker = createReadTracker();
		// Should not throw
		tracker.setStillInContext("/unknown.ts", false);
		expect(tracker.get("/unknown.ts")).toBeUndefined();
	});

	test("flips stillInContext back and forth", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");

		tracker.setStillInContext("/a.ts", false);
		expect(tracker.get("/a.ts")!.stillInContext).toBe(false);

		tracker.setStillInContext("/a.ts", true);
		expect(tracker.get("/a.ts")!.stillInContext).toBe(true);
	});
});

// ── 3. Iteration ──────────────────────────────────────────────────────

describe("entries", () => {
	test("returns empty iterator when nothing tracked", () => {
		const tracker = createReadTracker();
		const result = Array.from(tracker.entries());
		expect(result.length).toBe(0);
	});

	test("yields all tracked paths and entries", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.track("/b.ts", "fp2", 1, "bbb");

		const result = Array.from(tracker.entries());
		expect(result.length).toBe(2);

		const map = new Map(result);
		expect(map.get("/a.ts")!.fingerprint).toBe("fp1");
		expect(map.get("/b.ts")!.fingerprint).toBe("fp2");
	});

	test("reflects stillInContext updates during iteration", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", false);

		const result = Array.from(tracker.entries());
		expect(result[0][1].stillInContext).toBe(false);
	});
});

// ── 4. Edge cases ─────────────────────────────────────────────────────

describe("edge cases", () => {
	test("handles empty string path", () => {
		const tracker = createReadTracker();
		tracker.track("", "fp1", 0, "");
		expect(tracker.get("")).toBeDefined();
		expect(tracker.get("")!.fingerprint).toBe("fp1");
	});

	test("handles very long path", () => {
		const tracker = createReadTracker();
		const longPath = "/" + "x".repeat(1000) + ".ts";
		tracker.track(longPath, "fp1", 0, "content");
		expect(tracker.get(longPath)!.fingerprint).toBe("fp1");
	});

	test("handles empty injectedText", () => {
		const tracker = createReadTracker();
		tracker.track("/empty.ts", "fp1", 0, "");
		expect(tracker.get("/empty.ts")!.injectedText).toBe("");
	});
});
