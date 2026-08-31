/**
 * Node parity target for the read deduplicator tracker.
 *
 * The retired source path was extensions/__tests__/read-deduplicator.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createReadTracker } from "../../read-deduplicator-internals/read-tracker.ts";

describe("read-deduplicator / createReadTracker", () => {
	test("returns undefined for never-tracked path", () => {
		const tracker = createReadTracker();
		assert.strictEqual(tracker.get("/tmp/never.md"), undefined);
	});

	test("tracks and retrieves fingerprint, turn, and injectedText", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/a.md", "fp-a", 5, "content of a", 10, 20);
		const entry = tracker.get("/tmp/a.md");
		assert.strictEqual(entry!.fingerprint, "fp-a");
		assert.strictEqual(entry!.turn, 5);
		assert.strictEqual(entry!.injectedText, "content of a");
		assert.strictEqual(entry!.stillInContext, true);
		assert.strictEqual(entry!.offset, 10);
		assert.strictEqual(entry!.limit, 20);
	});

	test("overwrites on second track of same path", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/b.md", "fp-v1", 2, "old content");
		tracker.track("/tmp/b.md", "fp-v2", 10, "new content");
		const entry = tracker.get("/tmp/b.md");
		assert.strictEqual(entry!.fingerprint, "fp-v2");
		assert.strictEqual(entry!.turn, 10);
		assert.strictEqual(entry!.injectedText, "new content");
	});

	test("stillInContext defaults to true after track", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/c.md", "fp-c", 3, "content");
		assert.strictEqual(tracker.get("/tmp/c.md")!.stillInContext, true);
	});

	test("setStillInContext updates the flag", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/d.md", "fp-d", 4, "content");
		tracker.setStillInContext("/tmp/d.md", false);
		assert.strictEqual(tracker.get("/tmp/d.md")!.stillInContext, false);
		tracker.setStillInContext("/tmp/d.md", true);
		assert.strictEqual(tracker.get("/tmp/d.md")!.stillInContext, true);
	});

	test("setStillInContext is a no-op for untracked paths", () => {
		const tracker = createReadTracker();
		tracker.setStillInContext("/tmp/ghost.md", false);
		assert.strictEqual(tracker.get("/tmp/ghost.md"), undefined);
	});

	test("entries iterates all tracked paths", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/x.md", "fp-x", 1, "x");
		tracker.track("/tmp/y.md", "fp-y", 2, "y");

		const paths: string[] = [];
		for (const [path] of tracker.entries()) {
			paths.push(path);
		}
		assert.ok(paths.includes("/tmp/x.md"));
		assert.ok(paths.includes("/tmp/y.md"));
	});

	test("entries reflects stillInContext changes", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/z.md", "fp-z", 1, "z");
		tracker.setStillInContext("/tmp/z.md", false);

		for (const [, entry] of tracker.entries()) {
			assert.strictEqual(entry.stillInContext, false);
		}
	});

	test("tracks different paths independently", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/x.md", "fp-x", 1, "x");
		tracker.track("/tmp/y.md", "fp-y", 2, "y");
		assert.strictEqual(tracker.get("/tmp/x.md")!.injectedText, "x");
		assert.strictEqual(tracker.get("/tmp/y.md")!.injectedText, "y");
	});

	test("returns cached text when fingerprint and line range match", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/cache.md", "fp-cache", 7, "cached content", 5, 15);

		assert.strictEqual(
			tracker.getCacheHit("/tmp/cache.md", "fp-cache", 5, 15),
			"cached content",
		);
	});

	test("misses cache for untracked path, fingerprint mismatch, or line range mismatch", () => {
		const tracker = createReadTracker();
		tracker.track("/tmp/cache.md", "fp-cache", 7, "cached content", 5, 15);

		assert.strictEqual(
			tracker.getCacheHit("/tmp/missing.md", "fp-cache", 5, 15),
			undefined,
		);
		assert.strictEqual(
			tracker.getCacheHit("/tmp/cache.md", "fp-other", 5, 15),
			undefined,
		);
		assert.strictEqual(
			tracker.getCacheHit("/tmp/cache.md", "fp-cache", 6, 15),
			undefined,
		);
		assert.strictEqual(
			tracker.getCacheHit("/tmp/cache.md", "fp-cache", 5, 16),
			undefined,
		);
	});
});
