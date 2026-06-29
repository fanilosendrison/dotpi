import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolves a path to absolute and resolves any symlinks.
 * Returns null if the file does not exist (realpathSync fails).
 */
export function normalizePath(rawPath: string, cwd: string): string | null {
  try {
    const resolved = path.resolve(cwd, rawPath);
    return fs.realpathSync(resolved);
  } catch {
    return null;
  }
}

/**
 * Loads the path filter configuration from the stats directory.
 * Returns an array of paths that should not be logged.
 */
export function loadPathFilter(statsDir: string): string[] {
  try {
    const filterPath = path.join(statsDir, ".pathfilter");
    if (!fs.existsSync(filterPath)) {
      return [];
    }
    const content = fs.readFileSync(filterPath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Checks if a normalized path matches any of the given filters.
 */
export function matchesFilter(normalizedPath: string, filters: string[]): boolean {
  for (const filter of filters) {
    if (normalizedPath.startsWith(filter)) {
      return true;
    }
  }
  return false;
}
