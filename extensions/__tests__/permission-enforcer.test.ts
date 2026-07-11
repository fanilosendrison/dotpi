import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPermissionGrantedForScope } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
import { importPiExtension } from "./pi-extension-loader";

const TEST_SCOPE = { agent: "pi", sessionId: "pi-session-a" };

interface SessionContext {
	sessionManager: {
		getSessionId(): string;
	};
}

type ExtensionHandler = (
	event: Record<string, unknown>,
	context: SessionContext,
) => Promise<unknown> | unknown;
type HandlerRegistry = Record<string, ExtensionHandler[]>;

const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

function resetRuntimeModules() {
	mock.restore();
	for (const path of [TELEMETRY_PATH]) {
		delete require.cache[require.resolve(path)];
	}
}

describe("permission-enforcer Pi extension", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-unit-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = join(tmpDir, "stats");
		process.env.PERMISSION_STATE_PATH = join(tmpDir, "state.json");
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		delete process.env.PERMISSION_STATE_PATH;
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	async function registerExtension(): Promise<HandlerRegistry> {
		resetRuntimeModules();
		const permissionEnforcerExt =
			await importPiExtension<(pi: ExtensionAPI) => void>(
				"permission-enforcer.ts",
			);
		const handlers: HandlerRegistry = {};
		const piMock = {
			on: (event: string, cb: ExtensionHandler) => {
				handlers[event] = [...(handlers[event] ?? []), cb];
			},
		};

		permissionEnforcerExt(piMock as unknown as ExtensionAPI);
		return handlers;
	}

	test("registers a before_agent_start handler", async () => {
		const handlers = await registerExtension();

		expect(handlers.before_agent_start).toHaveLength(1);
	});

	test("grants permission for slash /go prompts", async () => {
		const handlers = await registerExtension();

		await handlers.before_agent_start[0](
			{ prompt: "please /go ahead" },
			createSessionContext(TEST_SCOPE.sessionId),
		);

		expect(isPermissionGrantedForScope(TEST_SCOPE)).toBe(true);
	});

	test("grants permission for expanded skill prompts", async () => {
		const handlers = await registerExtension();

		const prompt = '<skill name="go">implementation rules</skill>';
		await handlers.before_agent_start[0](
			{ prompt },
			createSessionContext(TEST_SCOPE.sessionId),
		);

		expect(isPermissionGrantedForScope(TEST_SCOPE)).toBe(true);
	});

	test("revokes permission for prompts without /go", async () => {
		const handlers = await registerExtension();

		await handlers.before_agent_start[0](
			{ prompt: "please /go ahead" },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(isPermissionGrantedForScope(TEST_SCOPE)).toBe(true);

		await handlers.before_agent_start[0](
			{
				prompt: "continue without changing files",
			},
			createSessionContext(TEST_SCOPE.sessionId),
		);

		expect(isPermissionGrantedForScope(TEST_SCOPE)).toBe(false);
	});
});

function createSessionContext(sessionId: string): SessionContext {
	return {
		sessionManager: {
			getSessionId: () => sessionId,
		},
	};
}
