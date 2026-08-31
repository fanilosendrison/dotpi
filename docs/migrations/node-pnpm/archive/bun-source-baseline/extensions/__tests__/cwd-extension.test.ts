import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import cwdExtension from "../cwd";
import type { RegisteredCommand } from "./cwd-test-helpers";

describe("cwd extension", () => {
	test("registers the /cwd command", () => {
		const registeredCommands: Array<{ name: string; command: RegisteredCommand }> = [];
		const piMock = {
			registerCommand: (name: string, command: RegisteredCommand) => {
				registeredCommands.push({ name, command });
			},
		};

		cwdExtension(piMock as unknown as ExtensionAPI);

		expect(registeredCommands).toHaveLength(1);
		const registeredCommand = registeredCommands[0];
		expect(registeredCommand.name).toBe("cwd");
		expect(registeredCommand.command.description).toContain("WezTerm");
		expect(registeredCommand.command.handler).toBeFunction();
	});
});
