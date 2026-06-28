/**
 * Pi extension — blocks writes directly to any dot* repo under Projects/
 * instead of through its ~/. prefix symlink.
 *
 * Rule: any path under ~/Developper/Projects/dot<name>/ must be written
 * through ~/.<name>/, never directly. The pattern is derived automatically
 * so new dot* repos are covered without code changes.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { realpathSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HOME = "/Users/famillesendrison";
const PROJECTS = join(HOME, "Developper", "Projects");

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) {
      return;
    }

    const givenPath = event.input.file_path;
    if (!givenPath || typeof givenPath !== "string") return;

    // Resolve to real path (follows symlinks)
    let real: string;
    try {
      real = realpathSync(givenPath);
    } catch {
      let ancestor = givenPath.replace(/\/[^/]+$/, "") || "/";
      while (ancestor && !existsSync(ancestor)) {
        ancestor = ancestor.replace(/\/[^/]+$/, "") || "/";
      }
      if (!ancestor || !existsSync(ancestor)) return;
      const rel = givenPath.slice(ancestor.length + 1);
      real = realpathSync(ancestor) + "/" + rel;
    }

    // Check if real path is inside any Projects/dot* repo
    if (!real.startsWith(PROJECTS + "/")) return;

    const relative = real.slice(PROJECTS.length + 1);
    const slashIdx = relative.indexOf("/");
    const repoDir = slashIdx === -1 ? relative : relative.slice(0, slashIdx);

    if (!repoDir.startsWith("dot")) return;

    const name = repoDir.slice(3); // strip "dot" prefix
    const gateway = join(HOME, "." + name);

    // Block unless given path already uses the gateway
    if (!givenPath.startsWith(gateway)) {
      return {
        block: true,
        reason:
          `Write through ~/.${name}/, not directly to ${repoDir}/.\n` +
          `  Given:  ${givenPath}\n` +
          `  Use:    ~/.${name}/${relative.slice(repoDir.length + 1)}`,
      };
    }
  });
}
