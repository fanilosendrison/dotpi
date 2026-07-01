import { describe, expect, test } from "bun:test";
import pathGuardExt from "../path-guard";

describe("path-guard Pi extension integration", () => {
	test("registers tool_call handlers and rewrites paths silently", async () => {
		const handlers: Function[] = [];
		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") {
					handlers.push(cb);
				}
			},
		};

		pathGuardExt(piMock as any);
		expect(handlers.length).toBe(2);

		const [writeEditHandler, bashHandler] = handlers;
		const HOME = process.env.HOME || "/Users/famillesendrison";

		// 1. Safe write path is unmodified
		const safeWriteEvent = {
			toolName: "write",
			input: { file_path: `${HOME}/.pi/agent/settings.json` },
		};
		await writeEditHandler(safeWriteEvent, {});
		expect(safeWriteEvent.input.file_path).toBe(`${HOME}/.pi/agent/settings.json`);

		// 2. Direct write path is rewritten
		const unsafeWriteEvent = {
			toolName: "write",
			input: { file_path: `${HOME}/Developper/Projects/dotpi/settings.json` },
		};
		await writeEditHandler(unsafeWriteEvent, {});
		expect(unsafeWriteEvent.input.file_path).toBe(`${HOME}/.pi/agent/settings.json`);

		// 3. Safe bash command is unmodified
		const safeBashEvent = {
			toolName: "bash",
			input: { command: "ls -la" },
		};
		await bashHandler(safeBashEvent, {});
		expect(safeBashEvent.input.command).toBe("ls -la");

		// 4. Unsafe bash command is rewritten
		const unsafeBashEvent = {
			toolName: "bash",
			input: { command: `echo 'hello' > ${HOME}/Developper/Projects/dotpi/settings.json` },
		};
		await bashHandler(unsafeBashEvent, {});
		expect(unsafeBashEvent.input.command).toContain("settings.json");
		expect(unsafeBashEvent.input.command).toContain("Redirection silencieuse vers");
		expect(unsafeBashEvent.input.command).toContain(`${HOME}/.pi/agent/settings.json`);
	});
});
