import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "../../shared/pi-telemetry.ts";

type HookHandler = (event: Record<string, unknown>) => unknown;

test("published event-sink preserves the Pi telemetry envelope", async (context) => {
	const statsDir = mkdtempSync(join(tmpdir(), "dotpi-node-event-sink-"));
	context.after(() => rmSync(statsDir, { recursive: true, force: true }));

	const handlers = new Map<string, HookHandler>();
	const pi = {
		on(event: string, handler: HookHandler) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;

	const telemetry = createPiTelemetry(pi, "node-migration-smoke", { statsDir });
	const providerHandler = handlers.get("before_provider_request");
	const thinkingHandler = handlers.get("thinking_level_select");
	assert.ok(providerHandler);
	assert.ok(thinkingHandler);

	await providerHandler({ payload: { model: "migration-model" } });
	await thinkingHandler({ level: "high" });
	telemetry.append(
		"migration_smoke",
		{ marker: "published-package" },
		{ timestamp: "2026-08-26T00:00:00.000Z" },
	);

	const lines = readFileSync(telemetry.sink.filePath, "utf8")
		.trim()
		.split("\n");
	assert.strictEqual(lines.length, 1);

	const event = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
	assert.strictEqual(event.timestamp, "2026-08-26T00:00:00.000Z");
	assert.match(
		String(event.eventId),
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
	);
	assert.strictEqual(event.agent, "pi");
	assert.strictEqual(event.namespace, "node-migration-smoke");
	assert.strictEqual(event.eventType, "migration_smoke");
	assert.strictEqual(event.workspace, process.cwd());
	assert.strictEqual(event.sessionId, telemetry.sessionId);
	assert.deepStrictEqual(event.details, {
		marker: "published-package",
		parentModel: "migration-model",
		thinkingLevel: "high",
	});
});
