import { resolve } from "node:path";
import { parseCwdArgs } from "./args";
import { interactiveCwd } from "./interactive";
import type { CwdCommandContext, CwdCommandDependencies } from "./types";
import { buildWezTermArgs, defaultDependencies } from "./wezterm";

export async function handleCwdCommand(
	args: string,
	ctx: CwdCommandContext,
	dependencies: CwdCommandDependencies = defaultDependencies,
): Promise<void> {
	if (args.trim() === "") {
		await interactiveCwd(ctx, dependencies);
		return;
	}

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
