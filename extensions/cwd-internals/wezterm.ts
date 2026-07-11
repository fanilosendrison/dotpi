import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CwdCommandDependencies, SplitType } from "./types";

const DEFAULT_BROWSER_START_PATH = join(homedir(), "Developper", "Projects");

const WEZTERM_SPLIT_FLAGS: Record<Exclude<SplitType, "--tab">, string> = {
	"--bottom": "--bottom",
	"--top": "--top",
	"--right": "--right",
	"--left": "--left",
	"--horizontal": "--horizontal",
	"--vertical": "--bottom",
};

export function buildWezTermArgs(splitType: SplitType, directory: string): string[] {
	if (splitType === "--tab") {
		return ["cli", "spawn", "--cwd", directory, "--", "pi"];
	}

	return [
		"cli",
		"split-pane",
		WEZTERM_SPLIT_FLAGS[splitType],
		"--cwd",
		directory,
		"--",
		"pi",
	];
}

export function directoryExists(directory: string): boolean {
	if (!existsSync(directory)) {
		return false;
	}

	try {
		return statSync(directory).isDirectory();
	} catch {
		return false;
	}
}

export function resolveInteractiveBrowserStartPath(
	cwd: string,
	pathExists: (directory: string) => boolean = directoryExists,
): string {
	return pathExists(DEFAULT_BROWSER_START_PATH) ? DEFAULT_BROWSER_START_PATH : cwd;
}

export const defaultDependencies: CwdCommandDependencies = {
	directoryExists,
	runWezTerm: (args) => {
		execFileSync("wezterm", args, { stdio: "ignore" });
	},
};
