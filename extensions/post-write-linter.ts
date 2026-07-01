import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

const HOME = process.env.HOME || "/Users/famillesendrison";
const linterPath = join(HOME, ".agents/agent-enforcers/post-write-linter/src/core/linter");
const { checkFile } = require(linterPath);

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") {
      return;
    }

    const filePath = event.input?.file_path || event.input?.path || event.input?.TargetFile;
    if (!filePath || typeof filePath !== "string") {
      return;
    }

    const result = checkFile(filePath);
    if (!result.success && result.output) {
      return {
        isError: true,
        content: `Biome linter errors in ${filePath}:\n\n${result.output}`,
      };
    }
  });
}
