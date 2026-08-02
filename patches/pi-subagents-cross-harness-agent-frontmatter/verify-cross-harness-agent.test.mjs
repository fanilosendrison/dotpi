import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const configuredExtensionDir = process.env.PI_SUBAGENTS_EXTENSION_DIR;
if (!configuredExtensionDir) {
	throw new Error("Set PI_SUBAGENTS_EXTENSION_DIR to the pi-subagents package root.");
}
const extensionDir = path.resolve(configuredExtensionDir);

const agentsModulePath = path.join(extensionDir, "src", "agents", "agents.ts");
if (!fs.existsSync(agentsModulePath)) {
	throw new Error(`pi-subagents agent loader was not found: ${agentsModulePath}`);
}

const { discoverAgents } = await import(pathToFileURL(agentsModulePath).href);
const managedEnvironment = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_OFFLINE"];
const savedEnvironment = new Map();

let tempDir = "";
let projectDir = "";

beforeEach(() => {
	for (const key of managedEnvironment) savedEnvironment.set(key, process.env[key]);
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cross-harness-agent-"));
	projectDir = path.join(tempDir, "project");
	const homeDir = path.join(tempDir, "home");
	fs.mkdirSync(homeDir, { recursive: true });
	fs.mkdirSync(projectDir, { recursive: true });
	process.env.HOME = homeDir;
	process.env.USERPROFILE = homeDir;
	process.env.PI_CODING_AGENT_DIR = path.join(tempDir, "agent");
	process.env.PI_OFFLINE = "true";
});

afterEach(() => {
	for (const key of managedEnvironment) {
		const value = savedEnvironment.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("cross-harness agent frontmatter patch", () => {
	it("overrides Claude metadata with Pi metadata and falls back to Pi defaults", () => {
		fs.mkdirSync(path.join(projectDir, ".agents"), { recursive: true });
		fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(projectDir, ".pi", "settings.json"), JSON.stringify({
			subagents: { defaultModel: "openai/gpt-5-mini" },
		}), "utf-8");
		fs.writeFileSync(path.join(projectDir, ".agents", "cross-harness.md"), `---
name: cross-harness
description: Shared agent description
model: claude-sonnet-4-6
tools: Read, Grep, Glob, Bash
pi:
  model: false
  tools: read, grep, find, ls, bash
  thinking: medium
  systemPromptMode: replace
  inheritProjectContext: true
  inheritSkills: false
---

Shared agent body.
`, "utf-8");

		const agent = discoverAgents(projectDir, "project").agents.find((candidate) => candidate.name === "cross-harness");

		assert.ok(agent, "expected the project .agents directory to define cross-harness");
		assert.equal(agent.source, "project");
		assert.equal(agent.localName, "cross-harness");
		assert.equal(agent.description, "Shared agent description");
		assert.equal(agent.systemPrompt, "Shared agent body.");
		assert.deepEqual(agent.tools, ["read", "grep", "find", "ls", "bash"]);
		assert.equal(agent.model, "openai/gpt-5-mini");
		assert.equal(agent.thinking, "medium");
		assert.equal(agent.systemPromptMode, "replace");
		assert.equal(agent.inheritProjectContext, true);
		assert.equal(agent.inheritSkills, false);
	});
});
