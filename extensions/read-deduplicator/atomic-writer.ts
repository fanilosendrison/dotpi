import * as fs from "node:fs";

export function atomicAppend(filePath: string, newContent: string): void {
  try {
    let existingContent = "";
    if (fs.existsSync(filePath)) {
      existingContent = fs.readFileSync(filePath, "utf-8");
    }
    
    const combinedContent = existingContent + newContent;
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    
    fs.writeFileSync(tmpPath, combinedContent);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    process.stderr.write(`[read-deduplicator] Error writing blocked log: ${err}\n`);
  }
}
