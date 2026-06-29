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
  
  if (!sessionId) {
    return path.join(statsDir, `ephemeral-${Date.now()}.md`);
  }
  
  return path.join(statsDir, `${sessionId}.md`);
}

export function detectExistingSession(
  filePath: string,
  sessionId: string
): "same" | "different" | "none" {
  if (!fs.existsSync(filePath)) {
    return "none";
  }
  
  try {
    // Read up to 200 bytes to check the header
    const buffer = Buffer.alloc(200);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buffer, 0, 200, 0);
    fs.closeSync(fd);
    
    const content = buffer.toString("utf-8", 0, bytesRead);
    
    if (content.includes(`# Session: ${sessionId}`)) {
      return "same";
    }
    
    // Check if it's an old session by looking for any session tag
    if (content.includes("# Session: ")) {
      return "different";
    }
    
    return "none";
  } catch {
    return "none";
  }
}

export function writeSessionHeader(
  filePath: string,
  sessionId: string | undefined,
  cwd: string,
  detectCollision: boolean = true
): void {
  if (detectCollision && sessionId && fs.existsSync(filePath)) {
    const status = detectExistingSession(filePath, sessionId);
    if (status === "same") {
      // Reuse file, don't write new header
      return;
    } else if (status === "different") {
      // Append separator and new header
      const header = `\n---\n\n# Session: ${sessionId}\n**Started** : ${new Date().toISOString()}\n**CWD** : \`${cwd}\`\n\n`;
      fs.appendFileSync(filePath, header);
      return;
    }
  }
  
  // New file header
  const sid = sessionId ?? "(ephemeral)";
  const header = `# Read Deduplicator — Blocked Reads Log\n> **Format version**: 0.1.0\n\n# Session: ${sid}\n**Started** : ${new Date().toISOString()}\n**CWD** : \`${cwd}\`\n\n`;
  fs.writeFileSync(filePath, header);
}
