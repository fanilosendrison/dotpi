import { DirectoryBrowser } from "./directory-browser";
import { pickSplitType } from "./split-picker";
import type { CwdCommandContext, CwdCommandDependencies } from "./types";
import { buildWezTermArgs, defaultDependencies, resolveInteractiveBrowserStartPath } from "./wezterm";

export async function interactiveCwd(
	ctx: CwdCommandContext,
	dependencies: CwdCommandDependencies = defaultDependencies,
): Promise<void> {
	if (!ctx.ui.custom) {
		ctx.ui.notify("/cwd interactive mode requires TUI mode", "error");
		return;
	}

	const browserStartPath = resolveInteractiveBrowserStartPath(ctx.cwd, dependencies.directoryExists);
	const selectedDirectory = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const browser = new DirectoryBrowser(browserStartPath, theme);
		browser.onSelect = (path) => done(path);
		browser.onCancel = () => done(null);

		return {
			render: (width: number) => browser.render(width),
			invalidate: () => browser.invalidate(),
			handleInput: (data: string) => {
				browser.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true });

	if (selectedDirectory === null) {
		return;
	}

	const splitType = await pickSplitType(ctx);
	if (splitType === null) {
		return;
	}

	if (!dependencies.directoryExists(selectedDirectory)) {
		ctx.ui.notify(`Directory not found: ${selectedDirectory}`, "error");
		return;
	}

	try {
		dependencies.runWezTerm(buildWezTermArgs(splitType, selectedDirectory));
	} catch {
		ctx.ui.notify("wezterm CLI not available. Are you inside WezTerm?", "error");
		return;
	}

	ctx.ui.notify(`Pi opened in split pane: ${selectedDirectory}`, "info");
}
