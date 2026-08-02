import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverAgents } from "../../src/agents/agents.ts";

const MANAGED_ENV = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_OFFLINE"] as const;
const savedEnv: Record<(typeof MANAGED_ENV)[number], string | undefined> = {
	HOME: undefined,
	USERPROFILE: undefined,
	PI_CODING_AGENT_DIR: undefined,
	PI_OFFLINE: undefined,
};

let tempDir = "";
let projectDir = "";

beforeEach(() => {
	for (const key of MANAGED_ENV) savedEnv[key] = process.env[key];
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
	for (const key of MANAGED_ENV) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("cross-harness agent frontmatter", () => {
	it("applies Pi metadata over Claude metadata and falls back to the Pi default model", () => {
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
