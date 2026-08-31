import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleCwdCommand } from "./cwd-internals/handler.ts";

export { parseCwdArgs } from "./cwd-internals/args.ts";
export { DirectoryBrowser } from "./cwd-internals/directory-browser.ts";
export { handleCwdCommand } from "./cwd-internals/handler.ts";
export { interactiveCwd } from "./cwd-internals/interactive.ts";
export type {
	CwdCommandContext,
	CwdCommandDependencies,
	ParsedCwdArgs,
	SplitType,
} from "./cwd-internals/types.ts";
export {
	buildWezTermArgs,
	resolveInteractiveBrowserStartPath,
} from "./cwd-internals/wezterm.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cwd", {
		description: "Open Pi in another directory via a WezTerm split pane",
		handler: async (args, ctx) => {
			await handleCwdCommand(args, ctx);
		},
	});
}
