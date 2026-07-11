import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "test-model-pathguard",
			thinking: "low",
			sessionId: "test-session-uuid-pathguard",
			contextDetails: () => ({
				parentModel: "test-model-pathguard",
				thinkingLevel: "low",
			}),
			append: (
				eventType: string,
				details: Record<string, unknown>,
				overrides?: Record<string, unknown>,
			) =>
				appendMock(
					eventType,
					{
						...details,
						parentModel: "test-model-pathguard",
						thinkingLevel: "low",
					},
					overrides,
				),
		}),
	}),
);

import pathGuardExt from "../path-guard";

afterAll(() => {
	mock.restore();
});

describe("path-guard Pi extension integration", () => {
	beforeEach(() => {
		appendMock.mockClear();
	});

	test("registers tool_call handlers and rewrites paths silently with telemetry", async () => {
		const handlers: Function[] = [];

		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") handlers.push(cb);
			},
		};

		pathGuardExt(piMock as any);
		expect(handlers.length).toBe(2);

		const [writeEditHandler, bashHandler] = handlers;
		const HOME = process.env.HOME || "/Users/famillesendrison";

		// 1. Safe write path targets dot repo but is correct → unmodified, logs action: correct
		const safeWriteEvent = {
			toolName: "write",
			input: { path: `${HOME}/.pi/agent/settings.json`, content: "" },
		};
		await writeEditHandler(safeWriteEvent, {});
		expect(safeWriteEvent.input.path).toBe(`${HOME}/.pi/agent/settings.json`);
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("path_access");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			toolType: "write",
			repo: "dotpi",
			action: "correct",
			givenPath: `${HOME}/.pi/agent/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});

		// 2. Direct write path is rewritten and emits redirected telemetry
		const unsafeWriteEvent = {
			toolName: "write",
			input: { path: `${HOME}/Developper/Projects/dotpi/settings.json`, content: "" },
		};
		await writeEditHandler(unsafeWriteEvent, {});
		expect(unsafeWriteEvent.input.path).toBe(`${HOME}/.pi/agent/settings.json`);
		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][0]).toBe("path_access");
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			toolType: "write",
			repo: "dotpi",
			action: "redirected",
			givenPath: `${HOME}/Developper/Projects/dotpi/settings.json`,
			rewrittenTo: `${HOME}/.pi/agent/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});

		// 3. Safe bash command does not target dot repo -> unmodified, no telemetry
		const safeBashEvent = {
			toolName: "bash",
			input: { command: "ls -la" },
		};
		await bashHandler(safeBashEvent, {});
		expect(safeBashEvent.input.command).toBe("ls -la");
		expect(appendMock).toHaveBeenCalledTimes(2); // Still 2

		// 4. Unsafe bash command is rewritten and emits redirected telemetry
		const unsafeBashEvent = {
			toolName: "bash",
			input: { command: `echo 'hello' > ${HOME}/Developper/Projects/dotpi/settings.json` },
		};
		await bashHandler(unsafeBashEvent, {});
		expect(unsafeBashEvent.input.command).toContain("settings.json");
		expect(unsafeBashEvent.input.command).toContain("Silent redirection to");
		expect(unsafeBashEvent.input.command).toContain(`${HOME}/.pi/agent/settings.json`);

		expect(appendMock).toHaveBeenCalledTimes(3);
		expect(appendMock.mock.calls[2][0]).toBe("path_access");
		expect(appendMock.mock.calls[2][1]).toMatchObject({
			toolType: "bash",
			repo: "dotpi",
			action: "redirected",
			givenPath: `${HOME}/Developper/Projects/dotpi/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});
	});
});
