/**
 * Node parity target for the read tracker module's direct tests.
 *
 * The retired source path was
 * extensions/read-deduplicator-internals/read-tracker.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createReadTracker } from "../../read-deduplicator-internals/read-tracker.ts";

describe("track / get", () => {
	test("returns undefined for untracked path", () => {
		const tracker = createReadTracker();
		assert.strictEqual(tracker.get("/unknown.ts"), undefined);
	});

	test("stores and retrieves a track entry", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "content a", 3, 9);

		const entry = tracker.get("/a.ts");
		assert.notStrictEqual(entry, undefined);
		assert.strictEqual(entry!.fingerprint, "fp1");
		assert.strictEqual(entry!.turn, 0);
		assert.strictEqual(entry!.injectedText, "content a");
		assert.strictEqual(entry!.stillInContext, true);
		assert.strictEqual(entry!.offset, 3);
		assert.strictEqual(entry!.limit, 9);
	});

	test("overwrites existing entry on re-track", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "content a");
		tracker.track("/a.ts", "fp2", 1, "content b");

		const entry = tracker.get("/a.ts");
		assert.strictEqual(entry!.fingerprint, "fp2");
		assert.strictEqual(entry!.turn, 1);
		assert.strictEqual(entry!.injectedText, "content b");
		assert.strictEqual(entry!.stillInContext, true);
	});

	test("tracks multiple paths independently", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.track("/b.ts", "fp2", 1, "bbb");

		assert.strictEqual(tracker.get("/a.ts")!.fingerprint, "fp1");
		assert.strictEqual(tracker.get("/b.ts")!.fingerprint, "fp2");
	});
});

describe("getCacheHit", () => {
	test("returns injected text when path, fingerprint, offset, and limit match", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "cached a", 10, 20);

		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp1", 10, 20), "cached a");
	});

	test("returns injected text for matching full-file reads", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "cached a");

		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp1"), "cached a");
	});

	test("misses when path, fingerprint, offset, or limit differ", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "cached a", 10, 20);

		assert.strictEqual(tracker.getCacheHit("/b.ts", "fp1", 10, 20), undefined);
		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp2", 10, 20), undefined);
		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp1", 11, 20), undefined);
		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp1", 10, 21), undefined);
		assert.strictEqual(tracker.getCacheHit("/a.ts", "fp1"), undefined);
	});
});

describe("setStillInContext", () => {
	test("marks an entry as still in context", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", true);

		assert.strictEqual(tracker.get("/a.ts")!.stillInContext, true);
	});

	test("marks an entry as no longer in context", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", false);

		assert.strictEqual(tracker.get("/a.ts")!.stillInContext, false);
	});

	test("is no-op for untracked path", () => {
		const tracker = createReadTracker();
		tracker.setStillInContext("/unknown.ts", false);
		assert.strictEqual(tracker.get("/unknown.ts"), undefined);
	});

	test("flips stillInContext back and forth", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");

		tracker.setStillInContext("/a.ts", false);
		assert.strictEqual(tracker.get("/a.ts")!.stillInContext, false);

		tracker.setStillInContext("/a.ts", true);
		assert.strictEqual(tracker.get("/a.ts")!.stillInContext, true);
	});
});

describe("entries", () => {
	test("returns empty iterator when nothing tracked", () => {
		const tracker = createReadTracker();
		const result = Array.from(tracker.entries());
		assert.strictEqual(result.length, 0);
	});

	test("yields all tracked paths and entries", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.track("/b.ts", "fp2", 1, "bbb");

		const result = Array.from(tracker.entries());
		assert.strictEqual(result.length, 2);

		const map = new Map(result);
		assert.strictEqual(map.get("/a.ts")!.fingerprint, "fp1");
		assert.strictEqual(map.get("/b.ts")!.fingerprint, "fp2");
	});

	test("reflects stillInContext updates during iteration", () => {
		const tracker = createReadTracker();
		tracker.track("/a.ts", "fp1", 0, "aaa");
		tracker.setStillInContext("/a.ts", false);

		const result = Array.from(tracker.entries());
		assert.strictEqual(result[0][1].stillInContext, false);
	});
});

describe("edge cases", () => {
	test("handles empty string path", () => {
		const tracker = createReadTracker();
		tracker.track("", "fp1", 0, "");
		assert.notStrictEqual(tracker.get(""), undefined);
		assert.strictEqual(tracker.get("")!.fingerprint, "fp1");
	});

	test("handles very long path", () => {
		const tracker = createReadTracker();
		const longPath = `/${"x".repeat(1000)}.ts`;
		tracker.track(longPath, "fp1", 0, "content");
		assert.strictEqual(tracker.get(longPath)!.fingerprint, "fp1");
	});

	test("handles empty injectedText", () => {
		const tracker = createReadTracker();
		tracker.track("/empty.ts", "fp1", 0, "");
		assert.strictEqual(tracker.get("/empty.ts")!.injectedText, "");
	});
});
