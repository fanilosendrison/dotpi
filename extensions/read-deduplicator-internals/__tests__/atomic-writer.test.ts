/**
 * Tests for read-deduplicator atomic-writer module.
 *
 * Tests atomic append behaviour: file creation, appending, content preservation.
 *
 * Note: atomicAppend does NOT create parent directories — that's the
 * caller's responsibility (handled by createBlockedLog).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicAppend } from "../lib/atomic-writer";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-writer-test-"));
	// Pre-create subdirectories used by tests that need nested paths
	fs.mkdirSync(path.join(tmpDir, "a", "b"), { recursive: true });
	fs.mkdirSync(path.join(tmpDir, "deeply", "nested"), { recursive: true });
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readContent(filePath: string): string {
	return fs.readFileSync(filePath, "utf-8");
}

// ── 1. File creation ─────────────────────────────────────────────────────

describe("file creation", () => {
	test("creates the file if it does not exist", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, '{"event":"a"}\n');

		expect(fs.existsSync(filePath)).toBe(true);
		expect(readContent(filePath)).toBe('{"event":"a"}\n');
	});

	test("writes to file in pre-existing subdirectory", () => {
		const filePath = path.join(tmpDir, "a", "b", "events.jsonl");
		atomicAppend(filePath, '{"event":"a"}\n');

		expect(fs.existsSync(filePath)).toBe(true);
		expect(readContent(filePath)).toBe('{"event":"a"}\n');
	});
});

// ── 2. Appending ─────────────────────────────────────────────────────────

describe("appending", () => {
	test("appends to an existing file", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, '{"event":"a"}\n');
		atomicAppend(filePath, '{"event":"b"}\n');

		const lines = readContent(filePath).trim().split("\n");
		expect(lines.length).toBe(2);
		expect(lines[0]).toBe('{"event":"a"}');
		expect(lines[1]).toBe('{"event":"b"}');
	});

	test("preserves existing content when appending", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, "line1\n");
		atomicAppend(filePath, "line2\n");
		atomicAppend(filePath, "line3\n");

		expect(readContent(filePath)).toBe("line1\nline2\nline3\n");
	});

	test("appends empty content without changing the file", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, "existing\n");
		atomicAppend(filePath, "");

		expect(readContent(filePath)).toBe("existing\n");
	});
});

// ── 3. Atomicity ─────────────────────────────────────────────────────────

describe("atomicity", () => {
	test("does not leave .tmp files behind", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, "data\n");

		const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.includes(".tmp."));
		expect(tmpFiles.length).toBe(0);
	});

	test("final file is a regular file (not a temp file)", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		atomicAppend(filePath, "data\n");

		const stat = fs.statSync(filePath);
		expect(stat.isFile()).toBe(true);
	});

	test("does not throw when target is a nested new path", () => {
		const filePath = path.join(tmpDir, "deeply", "nested", "events.jsonl");
		expect(() => atomicAppend(filePath, "data\n")).not.toThrow();
	});
});

// ── 4. Content integrity ────────────────────────────────────────────────

describe("content integrity", () => {
	test("writes valid JSONL content across multiple appends", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		const events = [
			{ event: "a", id: 1 },
			{ event: "b", id: 2 },
			{ event: "c", id: 3 },
		];

		for (const ev of events) {
			atomicAppend(filePath, JSON.stringify(ev) + "\n");
		}

		const lines = readContent(filePath)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));

		expect(lines.length).toBe(3);
		expect(lines[0].event).toBe("a");
		expect(lines[1].event).toBe("b");
		expect(lines[2].event).toBe("c");
	});

	test("handles special characters in content", () => {
		const filePath = path.join(tmpDir, "events.jsonl");
		const special = '{"path":"/a/b.ts","msg":"line1\\nline2"}';
		atomicAppend(filePath, special + "\n");

		const parsed = JSON.parse(readContent(filePath).trim());
		expect(parsed.path).toBe("/a/b.ts");
		expect(parsed.msg).toBe("line1\nline2");
	});
});
