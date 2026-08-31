import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
	importAgentModule,
	importPiExtension,
} from "./pi-extension-loader.node.ts";

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

type ExtensionFactory = (pi: {
	on: (event: string, handler: ExtensionHandler) => void;
}) => void;

interface PermissionStateModule {
	isPermissionGrantedForScope(scope: {
		agent: string;
		sessionId: string;
	}): boolean;
}

const { isPermissionGrantedForScope } =
	await importAgentModule<PermissionStateModule>(
		"agent-enforcers",
		"permission-enforcer",
		"src",
		"core",
		"state.ts",
	);

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
		const permissionEnforcerExt = await importPiExtension<ExtensionFactory>(
			"permission-enforcer.ts",
		);
		const handlers: HandlerRegistry = {};
		const piMock = {
			on: (event: string, handler: ExtensionHandler) => {
				handlers[event] = [...(handlers[event] ?? []), handler];
			},
		};

		permissionEnforcerExt(piMock);
		return handlers;
	}

	test("registers a before_agent_start handler", async () => {
		const handlers = await registerExtension();

		assert.strictEqual(handlers.before_agent_start.length, 1);
	});

	test("grants permission for slash /go prompts", async () => {
		const handlers = await registerExtension();

		await handlers.before_agent_start[0](
			{ prompt: "please /go ahead" },
			createSessionContext(TEST_SCOPE.sessionId),
		);

		assert.strictEqual(isPermissionGrantedForScope(TEST_SCOPE), true);
	});

	test("grants permission for expanded skill prompts", async () => {
		const handlers = await registerExtension();

		const prompt = '<skill name="go">implementation rules</skill>';
		await handlers.before_agent_start[0](
			{ prompt },
			createSessionContext(TEST_SCOPE.sessionId),
		);

		assert.strictEqual(isPermissionGrantedForScope(TEST_SCOPE), true);
	});

	test("revokes permission for prompts without /go", async () => {
		const handlers = await registerExtension();

		await handlers.before_agent_start[0](
			{ prompt: "please /go ahead" },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.strictEqual(isPermissionGrantedForScope(TEST_SCOPE), true);

		await handlers.before_agent_start[0](
			{
				prompt: "continue without changing files",
			},
			createSessionContext(TEST_SCOPE.sessionId),
		);

		assert.strictEqual(isPermissionGrantedForScope(TEST_SCOPE), false);
	});
});

function createSessionContext(sessionId: string): SessionContext {
	return {
		sessionManager: {
			getSessionId: () => sessionId,
		},
	};
}
