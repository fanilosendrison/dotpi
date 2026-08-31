/**
 * Node parity target for path-guard telemetry contracts.
 *
 * The retired source path was
 * extensions/__tests__/path-guard.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

interface PathAccessEvent {
	readonly eventType: string;
	readonly namespace: string;
	readonly agent: string;
	readonly sessionId: string;
	readonly workspace: string;
	readonly timestamp: string;
	readonly eventId: string;
	readonly cycleId?: unknown;
	readonly details: Readonly<Record<string, unknown>>;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pg-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly PathAccessEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as PathAccessEvent);
}

const BASE = {
	agent: "pi",
	namespace: "path-guard",
	sessionId: "sess-1",
	workspace: "/cwd",
};

describe("path_access contract", () => {
	test("writes path_access with all fields (redirected, write, with rewrittenTo, without originalCmd)", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "write",
				repo: "dotpi",
				action: "redirected",
				givenPath: "/dotpi/foo.ts",
				rewrittenTo: "/.pi/agent/foo.ts",
				parentModel: "deepseek-v4-flash",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "2026-07-04T12:00:00.000Z" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "path_access");
		assert.strictEqual(event.namespace, "path-guard");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.sessionId, "sess-1");
		assert.strictEqual(event.workspace, "/cwd");
		assert.strictEqual(event.details.toolType, "write");
		assert.strictEqual(event.details.repo, "dotpi");
		assert.strictEqual(event.details.action, "redirected");
		assert.strictEqual(event.details.givenPath, "/dotpi/foo.ts");
		assert.strictEqual(event.details.rewrittenTo, "/.pi/agent/foo.ts");
		assert.strictEqual(event.details.parentModel, "deepseek-v4-flash");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.originalCmd, undefined);
		assert.strictEqual(event.timestamp, "2026-07-04T12:00:00.000Z");
		assert.notStrictEqual(event.eventId, undefined);
	});

	test("writes path_access for correct actions without rewrittenTo/originalCmd", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "bash",
				repo: "dotpi",
				action: "correct",
				givenPath: "/dotpi/cmd",
				parentModel: "m1",
				thinkingLevel: "low",
			},
			{ timestamp: "t1" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.details.action, "correct");
		assert.strictEqual(event.details.rewrittenTo, undefined);
		assert.strictEqual(event.details.originalCmd, undefined);
	});

	test("truncates originalCmd to 200 chars", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const originalCmd = "x".repeat(250);
		const details = {
			toolType: "bash" as const,
			repo: "dotpi",
			action: "redirected" as const,
			givenPath: "/x",
			rewrittenTo: "/y",
			originalCmd:
				originalCmd.length <= 200
					? originalCmd
					: `${originalCmd.slice(0, 200)}…`,
			parentModel: "m1",
			thinkingLevel: "xhigh",
		};

		sink.append("path_access", details, { timestamp: "t1" });

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		const loggedOriginalCommand = event.details.originalCmd;
		assert.ok(typeof loggedOriginalCommand === "string");
		assert.strictEqual(loggedOriginalCommand.length, 201);
		assert.strictEqual(loggedOriginalCommand.endsWith("…"), true);
	});

	test("no cycleId field present", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "bash",
				repo: "dotpi",
				action: "redirected",
				givenPath: "/a",
				rewrittenTo: "/b",
				originalCmd: "cmd",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.cycleId, undefined);
	});
});
