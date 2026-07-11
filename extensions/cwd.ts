import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleCwdCommand } from "./cwd-internals/handler";

export { parseCwdArgs } from "./cwd-internals/args";
export { DirectoryBrowser } from "./cwd-internals/directory-browser";
export { handleCwdCommand } from "./cwd-internals/handler";
export { interactiveCwd } from "./cwd-internals/interactive";
export type { CwdCommandContext, CwdCommandDependencies, ParsedCwdArgs, SplitType } from "./cwd-internals/types";
export { buildWezTermArgs, resolveInteractiveBrowserStartPath } from "./cwd-internals/wezterm";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cwd", {
		description: "Open Pi in another directory via a WezTerm split pane",
		handler: async (args, ctx) => {
			await handleCwdCommand(args, ctx);
		},
	});
}
