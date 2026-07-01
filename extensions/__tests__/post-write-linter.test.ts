import { describe, expect, test } from "bun:test";
import postWriteLinter from "../post-write-linter";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("post-write-linter Pi extension", () => {
  test("registers a tool_result handler and handles clean/dirty TS files", async () => {
    let handler: Function | null = null;
    const piMock = {
      on: (event: string, cb: Function) => {
        if (event === "tool_result") {
          handler = cb;
        }
      }
    };

    postWriteLinter(piMock as any);

    expect(handler).not.toBeNull();

    // 1. Should ignore other tools
    const otherResult = await handler!({ toolName: "bash", input: {} }, {});
    expect(otherResult).toBeUndefined();

    // 2. Should run on TS files and pass if valid
    const root = await mkdtemp(join(tmpdir(), "pi-linter-"));
    const validFile = join(root, "valid.ts");
    await writeFile(validFile, "export const a = 1;\n");

    const validResult = await handler!({
      toolName: "write",
      input: { file_path: validFile }
    }, {});
    expect(validResult).toBeUndefined();

    // 3. Should fail if TS file is invalid
    const invalidFile = join(root, "invalid.ts");
    await writeFile(invalidFile, "const a = {\n");

    const invalidResult = await handler!({
      toolName: "write",
      input: { file_path: invalidFile }
    }, {});
    expect(invalidResult).toBeDefined();
    expect(invalidResult!.isError).toBe(true);
    expect(invalidResult!.content).toContain("Biome linter errors");
  });
});
