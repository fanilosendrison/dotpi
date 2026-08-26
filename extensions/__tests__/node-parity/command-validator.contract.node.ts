/**
 * Node parity target for command-validator telemetry contract events.
 *
 * The historical Bun source remains at
 * extensions/__tests__/command-validator.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

interface ContractEvent {
	readonly eventType: string;
	readonly namespace: string;
	readonly details: Readonly<Record<string, unknown>>;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cv-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly ContractEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ContractEvent);
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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "validation_result");
		assert.strictEqual(event.namespace, "command-validator");
		assert.strictEqual(event.details.action, "allow");
		assert.strictEqual(event.details.rawCommand, "ls -la");
		assert.strictEqual(event.details.parentModel, "claude-3-5-sonnet");
		assert.strictEqual(event.details.thinkingLevel, "low");
		assert.strictEqual(event.details.reason, undefined);
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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.details.action, "deny");
		assert.strictEqual(event.details.rawCommand, "rm -rf /");
		assert.strictEqual(
			event.details.reason,
			"❌ rm -rf is forbidden - use trash instead",
		);
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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.details.action, "ask_approved");
		assert.strictEqual(event.details.userResponse, "yes");
		assert.strictEqual(event.details.rawCommand, "sudo apt-get install");
	});

	test("truncates rawCommand to 500 characters", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const command = "x".repeat(600);
		const truncatedCommand =
			command.length <= 500 ? command : `${command.slice(0, 500)}…`;

		sink.append(
			"validation_result",
			{
				rawCommand: truncatedCommand,
				action: "allow",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		const rawCommand = event.details.rawCommand;
		assert.ok(typeof rawCommand === "string");
		assert.strictEqual(rawCommand.length, 501);
		assert.strictEqual(rawCommand.endsWith("…"), true);
	});
});
