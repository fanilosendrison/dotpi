import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SPLIT_TYPES = [
	"--bottom",
	"--top",
	"--right",
	"--left",
	"--horizontal",
	"--vertical",
	"--tab",
] as const;

const INVALID_SPLIT_TYPE_MESSAGE =
	"Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab";

type SplitType = (typeof SPLIT_TYPES)[number];

type ParsedCwdArgs =
	| {
			ok: true;
			splitType: SplitType;
			directoryArgument: string;
	  }
	| {
			ok: false;
			message: string;
	  };

type CwdCommandContext = {
	cwd: string;
	ui: {
		notify: (message: string, level: "info" | "warning" | "error") => void;
	};
};

type CwdCommandDependencies = {
	directoryExists: (directory: string) => boolean;
	runWezTerm: (args: string[]) => void;
};

const WEZTERM_SPLIT_FLAGS: Record<Exclude<SplitType, "--tab">, string> = {
	"--bottom": "--bottom",
	"--top": "--top",
	"--right": "--right",
	"--left": "--left",
	"--horizontal": "--horizontal",
	"--vertical": "--bottom",
};

function isSplitType(value: string): value is SplitType {
	return SPLIT_TYPES.includes(value as SplitType);
}

function tokenizeArgs(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;

	for (const char of args) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) {
		current += "\\";
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

export function parseCwdArgs(args: string): ParsedCwdArgs {
	const tokens = tokenizeArgs(args.trim());
	let splitType: SplitType = "--bottom";
	const pathTokens: string[] = [];

	for (const token of tokens) {
		if (isSplitType(token)) {
			splitType = token;
			continue;
		}

		if (token.startsWith("--")) {
			return { ok: false, message: INVALID_SPLIT_TYPE_MESSAGE };
		}

		pathTokens.push(token);
	}

	return {
		ok: true,
		splitType,
		directoryArgument: pathTokens.length > 0 ? pathTokens.join(" ") : ".",
	};
}

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

function directoryExists(directory: string): boolean {
	if (!existsSync(directory)) {
		return false;
	}

	try {
		return statSync(directory).isDirectory();
	} catch {
		return false;
	}
}

const defaultDependencies: CwdCommandDependencies = {
	directoryExists,
	runWezTerm: (args) => {
		execFileSync("wezterm", args, { stdio: "ignore" });
	},
};

export async function handleCwdCommand(
	args: string,
	ctx: CwdCommandContext,
	dependencies: CwdCommandDependencies = defaultDependencies,
): Promise<void> {
	const parsed = parseCwdArgs(args);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.message, "error");
		return;
	}

	const directory = resolve(ctx.cwd, parsed.directoryArgument);
	if (!dependencies.directoryExists(directory)) {
		ctx.ui.notify(`Directory not found: ${directory}`, "error");
		return;
	}

	try {
		dependencies.runWezTerm(buildWezTermArgs(parsed.splitType, directory));
	} catch {
		ctx.ui.notify("wezterm CLI not available. Are you inside WezTerm?", "error");
		return;
	}

	ctx.ui.notify(`Pi opened in split pane: ${directory}`, "info");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cwd", {
		description: "Open Pi in another directory via a WezTerm split pane",
		handler: async (args, ctx) => {
			await handleCwdCommand(args, ctx);
		},
	});
}
