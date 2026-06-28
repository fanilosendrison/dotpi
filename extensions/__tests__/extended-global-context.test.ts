import { describe, expect, test } from "bun:test";

// Extract the injection logic for testing (mirrors the extension)
const AGENTS_PATH = "/fake/.agents/AGENTS.md";

function injectAgentsMd(systemPrompt: string, agentsContent: string): string {
  const xmlBlock =
    `<project_instructions path="${AGENTS_PATH}">\n${agentsContent}\n</project_instructions>`;

  const ctxTag = "<project_context>";
  if (systemPrompt.includes(ctxTag)) {
    // Insert right after the opening tag (before any existing instructions)
    return systemPrompt.replace(
      ctxTag,
      `${ctxTag}\n\n${xmlBlock}`,
    );
  } else {
    // No project_context yet — append before current date section
    return systemPrompt + `\n\n${ctxTag}\n\n${xmlBlock}\n</project_context>\n`;
  }
}

describe("extended-global-context", () => {
  test("injects into existing project_context tag", () => {
    const prompt = "Some header\n<project_context>\nExisting\n</project_context>\nMore text";
    const result = injectAgentsMd(prompt, "AGENTS CONTENT");
    expect(result).toContain("Some header");
    expect(result).toContain("<project_context>");
    expect(result).toContain("AGENTS CONTENT");
    expect(result).toContain("Existing");
    // The injected block should appear before Existing
    const ctxIdx = result.indexOf("<project_context>");
    const injectedIdx = result.indexOf("<project_instructions");
    const existingIdx = result.indexOf("Existing");
    expect(ctxIdx).toBeLessThan(injectedIdx);
    expect(injectedIdx).toBeLessThan(existingIdx);
  });

  test("creates project_context if absent", () => {
    const prompt = "System prompt without project context";
    const result = injectAgentsMd(prompt, "AGENTS CONTENT");
    expect(result).toContain("<project_context>");
    expect(result).toContain("AGENTS CONTENT");
    expect(result).toContain("</project_context>");
    expect(result.startsWith(prompt)).toBe(true);
  });

  test("handles empty agents content", () => {
    const prompt = "<project_context>\n</project_context>";
    const result = injectAgentsMd(prompt, "");
    expect(result).toContain("<project_context>");
    // Empty content still produces the xml block
    expect(result).toContain("<project_instructions");
  });

  test("path is hardcoded to ~/.agents/AGENTS.md", () => {
    const prompt = "<project_context>\n</project_context>";
    const result = injectAgentsMd(prompt, "test");
    expect(result).toContain(AGENTS_PATH);
  });

  test("handles multiple project_context tags (uses first match)", () => {
    const prompt = "<project_context>\nFirst\n</project_context>\n<project_context>\nSecond\n</project_context>";
    const result = injectAgentsMd(prompt, "CONTENT");
    // Should inject after the first tag only
    const firstCtx = result.indexOf("<project_context>");
    const secondCtx = result.indexOf("<project_context>", firstCtx + 1);
    expect(secondCtx).toBeGreaterThan(firstCtx);
    // The injection should be between first and second
    const injectIdx = result.indexOf("<project_instructions");
    expect(injectIdx).toBeGreaterThan(firstCtx);
    expect(injectIdx).toBeLessThan(secondCtx);
  });

  test("preserves original prompt content", () => {
    const prompt = "You are a helpful assistant.\n<project_context>\nInstructions\n</project_context>\nBe concise.";
    const result = injectAgentsMd(prompt, "EXTRA");
    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("Instructions");
    expect(result).toContain("Be concise.");
    expect(result).toContain("EXTRA");
  });
});
