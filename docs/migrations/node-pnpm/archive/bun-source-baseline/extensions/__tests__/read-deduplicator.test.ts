import { describe, expect, test } from "bun:test";
import { createReadTracker } from "../read-deduplicator-internals/read-tracker";

describe("read-deduplicator / createReadTracker", () => {
	// ── get / track ────────────────────────────────────────────────────────
	test("returns undefined for never-tracked path", () => {
		const t = createReadTracker();
		expect(t.get("/tmp/never.md")).toBeUndefined();
	});

	test("tracks and retrieves fingerprint, turn, and injectedText", () => {
		const t = createReadTracker();
		t.track("/tmp/a.md", "fp-a", 5, "content of a", 10, 20);
		const entry = t.get("/tmp/a.md");
		expect(entry!.fingerprint).toBe("fp-a");
		expect(entry!.turn).toBe(5);
		expect(entry!.injectedText).toBe("content of a");
		expect(entry!.stillInContext).toBe(true);
		expect(entry!.offset).toBe(10);
		expect(entry!.limit).toBe(20);
	});

	test("overwrites on second track of same path", () => {
		const t = createReadTracker();
		t.track("/tmp/b.md", "fp-v1", 2, "old content");
		t.track("/tmp/b.md", "fp-v2", 10, "new content");
		const entry = t.get("/tmp/b.md");
		expect(entry!.fingerprint).toBe("fp-v2");
		expect(entry!.turn).toBe(10);
		expect(entry!.injectedText).toBe("new content");
	});

	// ── stillInContext ─────────────────────────────────────────────────────
	test("stillInContext defaults to true after track", () => {
		const t = createReadTracker();
		t.track("/tmp/c.md", "fp-c", 3, "content");
		expect(t.get("/tmp/c.md")!.stillInContext).toBe(true);
	});

	test("setStillInContext updates the flag", () => {
		const t = createReadTracker();
		t.track("/tmp/d.md", "fp-d", 4, "content");
		t.setStillInContext("/tmp/d.md", false);
		expect(t.get("/tmp/d.md")!.stillInContext).toBe(false);
		t.setStillInContext("/tmp/d.md", true);
		expect(t.get("/tmp/d.md")!.stillInContext).toBe(true);
	});

	test("setStillInContext is a no-op for untracked paths", () => {
		const t = createReadTracker();
		t.setStillInContext("/tmp/ghost.md", false);
		expect(t.get("/tmp/ghost.md")).toBeUndefined();
	});

	// ── entries ────────────────────────────────────────────────────────────
	test("entries iterates all tracked paths", () => {
		const t = createReadTracker();
		t.track("/tmp/x.md", "fp-x", 1, "x");
		t.track("/tmp/y.md", "fp-y", 2, "y");

		const paths: string[] = [];
		for (const [path] of t.entries()) {
			paths.push(path);
		}
		expect(paths).toContain("/tmp/x.md");
		expect(paths).toContain("/tmp/y.md");
	});

	test("entries reflects stillInContext changes", () => {
		const t = createReadTracker();
		t.track("/tmp/z.md", "fp-z", 1, "z");
		t.setStillInContext("/tmp/z.md", false);

		for (const [, entry] of t.entries()) {
			expect(entry.stillInContext).toBe(false);
		}
	});

	// ── independent paths ──────────────────────────────────────────────────
	test("tracks different paths independently", () => {
		const t = createReadTracker();
		t.track("/tmp/x.md", "fp-x", 1, "x");
		t.track("/tmp/y.md", "fp-y", 2, "y");
		expect(t.get("/tmp/x.md")!.injectedText).toBe("x");
		expect(t.get("/tmp/y.md")!.injectedText).toBe("y");
	});

	// ── cache hits ─────────────────────────────────────────────────────────
	test("returns cached text when fingerprint and line range match", () => {
		const t = createReadTracker();
		t.track("/tmp/cache.md", "fp-cache", 7, "cached content", 5, 15);

		expect(t.getCacheHit("/tmp/cache.md", "fp-cache", 5, 15)).toBe(
			"cached content",
		);
	});

	test("misses cache for untracked path, fingerprint mismatch, or line range mismatch", () => {
		const t = createReadTracker();
		t.track("/tmp/cache.md", "fp-cache", 7, "cached content", 5, 15);

		expect(t.getCacheHit("/tmp/missing.md", "fp-cache", 5, 15)).toBeUndefined();
		expect(t.getCacheHit("/tmp/cache.md", "fp-other", 5, 15)).toBeUndefined();
		expect(t.getCacheHit("/tmp/cache.md", "fp-cache", 6, 15)).toBeUndefined();
		expect(t.getCacheHit("/tmp/cache.md", "fp-cache", 5, 16)).toBeUndefined();
	});
});
