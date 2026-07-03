import * as fs from "node:fs";
import * as path from "node:path";

export function ensureDirectory(statsDir: string): void {
  fs.mkdirSync(statsDir, { recursive: true });
}

export function resolveSessionFilePath(
  statsDir: string,
  sessionId?: string,
  forceFilePath?: string
): string {
  if (forceFilePath) {
    return forceFilePath;
  }
  return path.join(statsDir, "events.jsonl");
}
