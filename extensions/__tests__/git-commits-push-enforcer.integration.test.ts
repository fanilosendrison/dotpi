import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolCallEvent {
	toolName: string;
	toolCallId?: string;
	input: Record<string, unknown>;
}

interface BlockResponse {
	block: true;
	reason: string;
}

type ToolCallHandler = (
	event: ToolCallEvent,
	context: Record<string, unknown>,
) => Promise<BlockResponse | undefined> | BlockResponse | undefined;

type ExtensionEntrypoint = (pi: ExtensionAPI) => void;

interface TelemetryEvent {
	eventType: string;
	agent: string;
	namespace: string;
	details: Record<string, unknown>;
}

const EXTENSION_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/git-commits-push-enforcer.ts";
const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

let moduleCounter = 0;

function resetRuntimeModules() {
	mock.restore();
	for (const path of [EXTENSION_PATH, TELEMETRY_PATH]) {
		delete require.cache[require.resolve(path)];
	}
}

function readEvents(statsBaseDir: string): TelemetryEvent[] {
	const eventsPath = join(
		statsBaseDir,
		"git-commits-push-enforcer",
		"events.jsonl",
	);
	if (!existsSync(eventsPath)) return [];

	return readFileSync(eventsPath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("git-commits-push-enforcer Pi extension integration", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;
	let originalBypass: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-gcpe-integration-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		originalBypass = process.env.BYPASS_GIT_ENFORCER;
		process.env.PI_TELEMETRY_BASE_DIR = join(tmpDir, "stats");
		delete process.env.BYPASS_GIT_ENFORCER;
		delete process.env.PI_PARENT_MODEL;
		delete process.env.PI_SESSION_ID;
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		if (originalBypass === undefined) {
			delete process.env.BYPASS_GIT_ENFORCER;
		} else {
			process.env.BYPASS_GIT_ENFORCER = originalBypass;
		}
		delete process.env.PI_PARENT_MODEL;
		delete process.env.PI_SESSION_ID;
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	async function registerExtension(): Promise<ToolCallHandler> {
		resetRuntimeModules();
		moduleCounter++;
		const extensionUrl = `${pathToFileURL(EXTENSION_PATH).href}?integration=${moduleCounter}`;
		const { default: pushEnforcerExt } = (await import(extensionUrl)) as {
			default: ExtensionEntrypoint;
		};
		let handler: ToolCallHandler | null = null;
		const piMock = {
			on: (event: string, cb: ToolCallHandler) => {
				if (event === "tool_call") handler = cb;
			},
		};

		pushEnforcerExt(piMock as unknown as ExtensionAPI);
		if (!handler) throw new Error("expected tool_call handler");
		return handler;
	}

	test("blocks raw git push and writes real blocked telemetry", async () => {
		const handler = await registerExtension();

		const result = await handler(
			{
				toolName: "bash",
				toolCallId: "call-real-push",
				input: { command: "git push origin main" },
			},
			{},
		);

		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("Use /git-commits-push"),
		});

		const events = readEvents(join(tmpDir, "stats"));
		expect(events).toHaveLength(1);
		expect(events[0]?.eventType).toBe("blocked");
		expect(events[0]?.agent).toBe("pi");
		expect(events[0]?.namespace).toBe("git-commits-push-enforcer");
		expect(events[0]?.details).toMatchObject({
			rawCommand: "git push origin main",
			detectedBy: "git-commit",
			toolCallId: "call-real-push",
			mutation: "push",
		});
	});

	test("allows skill launch and writes real enforcer_triggered telemetry", async () => {
		const handler = await registerExtension();
		const command = "cd ~/.agents/skills/git-commits-push && bun run start";

		const result = await handler(
			{
				toolName: "bash",
				toolCallId: "call-real-skill",
				input: { command },
			},
			{},
		);

		expect(result).toBeUndefined();
		expect(process.env.PI_SESSION_ID).toBeDefined();

		const events = readEvents(join(tmpDir, "stats"));
		expect(events).toHaveLength(1);
		expect(events[0]?.eventType).toBe("enforcer_triggered");
		expect(events[0]?.details).toMatchObject({
			rawCommand: command,
			detectedBy: "git-commits-push",
			toolCallId: "call-real-skill",
		});
		expect(events[0]?.details.mutation).toBeUndefined();
	});
});
