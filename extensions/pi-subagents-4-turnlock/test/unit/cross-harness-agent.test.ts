import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, parseFrontmatterList } from "../../src/agents/frontmatter.ts";

const agentsDir = join(homedir(), ".agents", "agents");

function loadAndMerge(file: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	const content = readFileSync(join(agentsDir, file), "utf-8");
	const { frontmatter, body } = parseFrontmatter(content);

	// Same merge logic as the pi-subagents patch
	if (frontmatter.pi && frontmatter.pi.trim()) {
		const piRaw = `---\n${frontmatter.pi.trim()}\n---`;
		const { frontmatter: piBlock } = parseFrontmatter(piRaw);
		for (const [key, value] of Object.entries(piBlock)) {
			if (value === "false" || value === "") {
				delete frontmatter[key];
			} else if (value) {
				frontmatter[key] = value;
			}
		}
	}

	return { frontmatter, body };
}

function tools(agent: string): string[] {
	const { frontmatter } = loadAndMerge(agent);
	return parseFrontmatterList(frontmatter.tools) ?? [];
}

describe("cross-harness agents", () => {
	test("coding-standards-file uses Pi tools, no Claude tools", () => {
		expect(tools("coding-standards-file.md").sort()).toEqual(
			["read", "grep", "find", "ls", "bash"].sort(),
		);
		expect(tools("coding-standards-file.md")).not.toContain("Read");
		expect(tools("coding-standards-file.md")).not.toContain("Grep");
		expect(tools("coding-standards-file.md")).not.toContain("Glob");
	});

	test("coding-standards-file model is cleared by model: false", () => {
		const { frontmatter } = loadAndMerge("coding-standards-file.md");
		expect(frontmatter.model).toBeUndefined();
	});

	test("coding-standards-file thinking is set from pi block", () => {
		const { frontmatter } = loadAndMerge("coding-standards-file.md");
		expect(frontmatter.thinking).toBe("medium");
	});

	test("coding-standards-file systemPromptMode is replace", () => {
		const { frontmatter } = loadAndMerge("coding-standards-file.md");
		expect(frontmatter.systemPromptMode).toBe("replace");
	});

	test("coding-standards-file inheritProjectContext is true", () => {
		const { frontmatter } = loadAndMerge("coding-standards-file.md");
		expect(frontmatter.inheritProjectContext).toBe("true");
	});

	test("fix-file has edit and write tools", () => {
		const allTools = tools("fix-file.md");
		expect(allTools).toContain("edit");
		expect(allTools).toContain("write");
		expect(allTools).not.toContain("Edit");
		expect(allTools).not.toContain("Write");
	});

	test("fix-file model is cleared", () => {
		const { frontmatter } = loadAndMerge("fix-file.md");
		expect(frontmatter.model).toBeUndefined();
	});

	test("body is preserved after merge", () => {
		const { body } = loadAndMerge("coding-standards-file.md");
		expect(body).toContain("# Mission");
		expect(body).toContain("Audit one existing source or test file");
	});

	test("name and description are never overwritten by pi block", () => {
		const { frontmatter } = loadAndMerge("coding-standards-file.md");
		expect(frontmatter.name).toBe("coding-standards-file");
		expect(frontmatter.description).toContain(
			"semantic coding-standards review",
		);
	});

	test("all 9 agents are present", () => {
		const expected = [
			"backlog-crush-orchestrator.md",
			"backlog-deep-crush-orchestrator.md",
			"backlog-fix.md",
			"coding-standards-file.md",
			"dedup-inter.md",
			"dedup-intra.md",
			"fix-file.md",
			"loop-clean-orchestrator.md",
			"senior-review-file.md",
		];
		for (const file of expected) {
			const { frontmatter } = loadAndMerge(file);
			expect(frontmatter.name).toBeTruthy();
			expect(frontmatter.description).toBeTruthy();
			// All must have pi tools, not Claude tools
			const t = tools(file);
			expect(t).not.toContain("Read");
			expect(t).not.toContain("Grep");
			// Every agent must have model cleared
			expect(frontmatter.model).toBeUndefined();
		}
	});

	test("all 9 agents have a non-empty body", () => {
		const files = [
			"backlog-crush-orchestrator.md",
			"backlog-deep-crush-orchestrator.md",
			"backlog-fix.md",
			"coding-standards-file.md",
			"dedup-inter.md",
			"dedup-intra.md",
			"fix-file.md",
			"loop-clean-orchestrator.md",
			"senior-review-file.md",
		];
		for (const file of files) {
			const { body } = loadAndMerge(file);
			expect(body.length).toBeGreaterThan(51);
		}
	});
});
