/**
 * Node parity target for extended global context injection helpers.
 *
 * The historical Bun source remains at extensions/__tests__/extended-global-context.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

const AGENTS_PATH = "/fake/.agents/AGENTS.md";

function injectAgentsMd(systemPrompt: string, agentsContent: string): string {
	const xmlBlock = `<project_instructions path="${AGENTS_PATH}">\n${agentsContent}\n</project_instructions>`;

	const contextTag = "<project_context>";
	if (systemPrompt.includes(contextTag)) {
		return systemPrompt.replace(contextTag, `${contextTag}\n\n${xmlBlock}`);
	}

	return `${systemPrompt}\n\n${contextTag}\n\n${xmlBlock}\n</project_context>\n`;
}

describe("extended-global-context", () => {
	test("injects into existing project_context tag", () => {
		const prompt =
			"Some header\n<project_context>\nExisting\n</project_context>\nMore text";
		const result = injectAgentsMd(prompt, "AGENTS CONTENT");
		assert.ok(result.includes("Some header"));
		assert.ok(result.includes("<project_context>"));
		assert.ok(result.includes("AGENTS CONTENT"));
		assert.ok(result.includes("Existing"));
		const contextIndex = result.indexOf("<project_context>");
		const injectedIndex = result.indexOf("<project_instructions");
		const existingIndex = result.indexOf("Existing");
		assert.ok(contextIndex < injectedIndex);
		assert.ok(injectedIndex < existingIndex);
	});

	test("creates project_context if absent", () => {
		const prompt = "System prompt without project context";
		const result = injectAgentsMd(prompt, "AGENTS CONTENT");
		assert.ok(result.includes("<project_context>"));
		assert.ok(result.includes("AGENTS CONTENT"));
		assert.ok(result.includes("</project_context>"));
		assert.strictEqual(result.startsWith(prompt), true);
	});

	test("handles empty agents content", () => {
		const prompt = "<project_context>\n</project_context>";
		const result = injectAgentsMd(prompt, "");
		assert.ok(result.includes("<project_context>"));
		assert.ok(result.includes("<project_instructions"));
	});

	test("path is hardcoded to ~/.agents/AGENTS.md", () => {
		const prompt = "<project_context>\n</project_context>";
		const result = injectAgentsMd(prompt, "test");
		assert.ok(result.includes(AGENTS_PATH));
	});

	test("handles multiple project_context tags (uses first match)", () => {
		const prompt =
			"<project_context>\nFirst\n</project_context>\n<project_context>\nSecond\n</project_context>";
		const result = injectAgentsMd(prompt, "CONTENT");
		const firstContext = result.indexOf("<project_context>");
		const secondContext = result.indexOf("<project_context>", firstContext + 1);
		assert.ok(secondContext > firstContext);
		const injectionIndex = result.indexOf("<project_instructions");
		assert.ok(injectionIndex > firstContext);
		assert.ok(injectionIndex < secondContext);
	});

	test("preserves original prompt content", () => {
		const prompt =
			"You are a helpful assistant.\n<project_context>\nInstructions\n</project_context>\nBe concise.";
		const result = injectAgentsMd(prompt, "EXTRA");
		assert.ok(result.includes("You are a helpful assistant."));
		assert.ok(result.includes("Instructions"));
		assert.ok(result.includes("Be concise."));
		assert.ok(result.includes("EXTRA"));
	});
});
