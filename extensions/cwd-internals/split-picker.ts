import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SelectItem,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";
import { isSplitType } from "./args.ts";
import type { CwdCommandContext, SplitType } from "./types.ts";

const SPLIT_TYPE_ITEMS: SelectItem[] = [
	{ value: "--bottom", label: "Bottom" },
	{ value: "--top", label: "Top" },
	{ value: "--right", label: "Right" },
	{ value: "--left", label: "Left" },
	{ value: "--horizontal", label: "Horizontal" },
	{ value: "--vertical", label: "Vertical" },
	{ value: "--tab", label: "New Tab" },
];

const SPLIT_PICKER_HELP_LINE = "↑↓ navigate · enter select · esc cancel";

export async function pickSplitType(
	ctx: CwdCommandContext,
): Promise<SplitType | null> {
	if (!ctx.ui.custom) {
		ctx.ui.notify("/cwd interactive mode requires TUI mode", "error");
		return null;
	}

	const result = await ctx.ui.custom<string | null>(
		(tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(
				new DynamicBorder((s: string) => theme.fg("accent", s)),
			);
			container.addChild(
				new Text(theme.fg("accent", theme.bold("Choose split type")), 1, 0),
			);

			const selectList = new SelectList(
				SPLIT_TYPE_ITEMS,
				SPLIT_TYPE_ITEMS.length,
				{
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				},
			);

			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			container.addChild(
				new Text(theme.fg("dim", SPLIT_PICKER_HELP_LINE), 1, 0),
			);
			container.addChild(
				new DynamicBorder((s: string) => theme.fg("accent", s)),
			);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{ overlay: true },
	);

	if (!result || !isSplitType(result)) {
		return null;
	}

	return result;
}
