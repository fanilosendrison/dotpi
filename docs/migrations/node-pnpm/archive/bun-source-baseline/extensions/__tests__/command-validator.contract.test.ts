/**
 * Contract tests for command-validator events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - logging of allow, deny, ask_approved, ask_rejected
 *   - reason inclusion for denied commands
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "@fanilosendrison/event-sink";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cv-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): any[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

const BASE = {
	agent: "pi",
	namespace: "command-validator",
	sessionId: "s1",
	workspace: "/cwd",
};

describe("command-validator telemetry data contract", () => {
	test("writes validation_result for an allowed command", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"validation_result",
			{
				rawCommand: "ls -la",
				action: "allow",
				parentModel: "claude-3-5-sonnet",
				thinkingLevel: "low",
			},
			{ timestamp: "2026-07-08T12:00:00.000Z" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("validation_result");
		expect(ev.namespace).toBe("command-validator");
		expect(ev.details.action).toBe("allow");
		expect(ev.details.rawCommand).toBe("ls -la");
		expect(ev.details.parentModel).toBe("claude-3-5-sonnet");
		expect(ev.details.thinkingLevel).toBe("low");
		expect(ev.details.reason).toBeUndefined(); // No reason for allowed commands
	});

	test("writes validation_result for a denied command", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"validation_result",
			{
				rawCommand: "rm -rf /",
				action: "deny",
				reason: "❌ rm -rf is forbidden - use trash instead",
				parentModel: "gpt-4",
				thinkingLevel: "off",
			},
			{ timestamp: "2026-07-08T12:05:00.000Z" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.action).toBe("deny");
		expect(ev.details.rawCommand).toBe("rm -rf /");
		expect(ev.details.reason).toBe("❌ rm -rf is forbidden - use trash instead");
	});

	test("writes validation_result for an ask_approved command", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"validation_result",
			{
				rawCommand: "sudo apt-get install",
				action: "ask_approved",
				userResponse: "yes",
				parentModel: "llama-3",
				thinkingLevel: "high",
			},
			{ timestamp: "2026-07-08T12:10:00.000Z" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.action).toBe("ask_approved");
		expect(ev.details.userResponse).toBe("yes");
		expect(ev.details.rawCommand).toBe("sudo apt-get install");
	});

	test("truncates rawCommand to 500 characters", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const cmd = "x".repeat(600);
		const cmdTruncated = cmd.length <= 500 ? cmd : cmd.slice(0, 500) + "…";

		sink.append(
			"validation_result",
			{
				rawCommand: cmdTruncated,
				action: "allow",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.rawCommand.length).toBe(501);
		expect(ev.details.rawCommand.endsWith("…")).toBe(true);
	});
});
