import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "test-model-linter",
			thinking: "low",
			sessionId: "test-session-uuid-linter",
		}),
	}),
);

import postWriteLinter from "../post-write-linter";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

afterAll(() => {
	mock.restore();
});

describe("post-write-linter Pi extension", () => {
	beforeEach(() => {
		appendMock.mockClear();
	});

	test("registers a tool_result handler and handles clean/dirty TS files with telemetry", async () => {
		let handler: Function | null = null;

		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_result") handler = cb;
			},
		};

		postWriteLinter(piMock as any);

		expect(handler).not.toBeNull();

		// 1. Should ignore other tools and not emit telemetry
		const otherResult = await handler!({ toolName: "bash", input: {} }, {});
		expect(otherResult).toBeUndefined();
		expect(appendMock).not.toHaveBeenCalled();

		// 2. Should run on TS files and pass if valid (emitting success telemetry)
		const root = await mkdtemp(join(tmpdir(), "pi-linter-"));
		const validFile = join(root, "valid.ts");
		await writeFile(validFile, "export const a = 1;\n");

		const validResult = await handler!(
			{
				toolName: "write",
				input: { file_path: validFile },
			},
			{},
		);
		expect(validResult).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("lint_result");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			filePath: validFile,
			language: "ts",
			status: "success",
			parentModel: "test-model-linter",
			thinkingLevel: "low",
		});

		// 3. Should fail if TS file is invalid (emitting error telemetry)
		const invalidFile = join(root, "invalid.ts");
		await writeFile(invalidFile, "const a = {\n");

		const invalidResult = await handler!(
			{
				toolName: "write",
				input: { file_path: invalidFile },
			},
			{},
		);
		expect(invalidResult).toBeDefined();
		expect(invalidResult!.isError).toBe(true);
		expect(invalidResult!.content[0].text).toContain("Biome linter errors");

		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][0]).toBe("lint_result");
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			filePath: invalidFile,
			language: "ts",
			status: "error",
			parentModel: "test-model-linter",
			thinkingLevel: "low",
		});
		expect(appendMock.mock.calls[1][1].output).toContain("error");
	});
});
