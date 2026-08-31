/**
 * Node parity target for the public cwd extension registration.
 *
 * The retired source path was extensions/__tests__/cwd-extension.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import cwdExtension from "../../cwd.ts";
import type { RegisteredCommand } from "../cwd-test-helpers.ts";

describe("cwd extension", () => {
	test("registers the /cwd command", () => {
		const registeredCommands: Array<{
			name: string;
			command: RegisteredCommand;
		}> = [];
		const piMock = {
			registerCommand: (name: string, command: RegisteredCommand) => {
				registeredCommands.push({ name, command });
			},
		};

		cwdExtension(piMock as unknown as ExtensionAPI);

		assert.strictEqual(registeredCommands.length, 1);
		const registeredCommand = registeredCommands[0];
		assert.strictEqual(registeredCommand.name, "cwd");
		assert.strictEqual(
			registeredCommand.command.description?.includes("WezTerm"),
			true,
		);
		assert.strictEqual(typeof registeredCommand.command.handler, "function");
	});
});
