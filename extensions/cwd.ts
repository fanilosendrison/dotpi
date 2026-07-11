import { DynamicBorder, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	type Component,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
		custom?: <T>(
			factory: (
				tui: { requestRender: () => void },
				theme: Theme,
				keybindings: unknown,
				done: (result: T) => void,
			) => Component | Promise<Component>,
			options?: { overlay?: boolean },
		) => Promise<T>;
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

const SPLIT_TYPE_ITEMS: SelectItem[] = [
	{ value: "--bottom", label: "Bottom" },
	{ value: "--top", label: "Top" },
	{ value: "--right", label: "Right" },
	{ value: "--left", label: "Left" },
	{ value: "--horizontal", label: "Horizontal" },
	{ value: "--vertical", label: "Vertical" },
	{ value: "--tab", label: "New Tab" },
];

const BROWSER_HELP_LINE = "↑↓ navigate · ↵ enter · ⌫ back · esc cancel";
const SPLIT_PICKER_HELP_LINE = "↑↓ navigate · enter select · esc cancel";
const DEFAULT_BROWSER_START_PATH = join(homedir(), "Developper", "Projects");

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

export function resolveInteractiveBrowserStartPath(
	cwd: string,
	pathExists: (directory: string) => boolean = directoryExists,
): string {
	return pathExists(DEFAULT_BROWSER_START_PATH) ? DEFAULT_BROWSER_START_PATH : cwd;
}

function isRootPath(path: string): boolean {
	return dirname(path) === path;
}

export class DirectoryBrowser {
	private currentPath: string;
	private entries: Dirent[] = [];
	private selectedIndex = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	public onSelect?: (path: string) => void;
	public onCancel?: () => void;

	constructor(startPath: string, private readonly theme: Theme) {
		this.currentPath = resolve(startPath);
		this.refreshEntries();
	}

	getCurrentPath(): string {
		return this.currentPath;
	}

	getSelectedIndex(): number {
		return this.selectedIndex;
	}

	getEntryNames(): string[] {
		return this.entries.map((entry) => entry.name);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private refreshEntries(): void {
		try {
			this.entries = readdirSync(this.currentPath, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.filter((entry) => !entry.name.startsWith("."))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			this.entries = [];
		}
		this.invalidate();
	}

	private itemCount(): number {
		return 1 + (isRootPath(this.currentPath) ? 0 : 1) + this.entries.length;
	}

	private goToParent(): void {
		if (isRootPath(this.currentPath)) {
			return;
		}

		this.currentPath = dirname(this.currentPath);
		this.selectedIndex = 0;
		this.refreshEntries();
	}

	private goToChild(entry: Dirent): void {
		this.currentPath = join(this.currentPath, entry.name);
		this.selectedIndex = 0;
		this.refreshEntries();
	}

	private renderItem(text: string, index: number, width: number, style?: (line: string) => string): string {
		const prefix = index === this.selectedIndex ? "> " : "  ";
		const line = truncateToWidth(`${prefix}${text}`, width);
		return style ? style(line) : line;
	}

	private renderEntryLines(width: number): string[] {
		const lines: string[] = [];
		let index = 0;

		lines.push(
			this.renderItem(
				"📂 Use this directory",
				index,
				width,
				index === this.selectedIndex
					? (line) => this.theme.fg("success", line)
					: (line) => this.theme.fg("dim", line),
			),
		);
		index += 1;

		if (!isRootPath(this.currentPath)) {
			lines.push(this.renderItem("..", index, width, (line) => this.theme.fg("muted", line)));
			index += 1;
		}

		for (const entry of this.entries) {
			lines.push(this.renderItem(`📁 ${entry.name}/`, index, width));
			index += 1;
		}

		return lines;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const border = new DynamicBorder((s: string) => this.theme.fg("border", s)).render(width)[0] ?? "";
		const lines = [
			border,
			truncateToWidth(`  ${this.theme.fg("accent", this.theme.bold("Navigate to directory"))}`, width),
			"",
			truncateToWidth(`  ${this.theme.fg("muted", `📁 ${this.currentPath}`)}`, width),
			border,
			...this.renderEntryLines(width),
			border,
			truncateToWidth(`  ${this.theme.fg("dim", BROWSER_HELP_LINE)}`, width),
		];

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	handleInput(data: string): void {
		const maxIndex = Math.max(0, this.itemCount() - 1);

		if (matchesKey(data, Key.up)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.down)) {
			this.selectedIndex = Math.min(maxIndex, this.selectedIndex + 1);
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.home)) {
			this.selectedIndex = 0;
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.end)) {
			this.selectedIndex = maxIndex;
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.backspace) || matchesKey(data, Key.left)) {
			this.goToParent();
			return;
		}

		if (matchesKey(data, Key.escape)) {
			this.onCancel?.();
			return;
		}

		if (!matchesKey(data, Key.enter)) {
			return;
		}

		if (this.selectedIndex === 0) {
			this.onSelect?.(this.currentPath);
			return;
		}

		const parentOffset = isRootPath(this.currentPath) ? 0 : 1;
		if (parentOffset === 1 && this.selectedIndex === 1) {
			this.goToParent();
			return;
		}

		const entry = this.entries[this.selectedIndex - parentOffset - 1];
		if (entry) {
			this.goToChild(entry);
		}
	}
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

async function pickSplitType(ctx: CwdCommandContext): Promise<SplitType | null> {
	if (!ctx.ui.custom) {
		ctx.ui.notify("/cwd interactive mode requires TUI mode", "error");
		return null;
	}

	const result = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Choose split type")), 1, 0));

		const selectList = new SelectList(SPLIT_TYPE_ITEMS, SPLIT_TYPE_ITEMS.length, {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});

		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", SPLIT_PICKER_HELP_LINE), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true });

	if (!result || !isSplitType(result)) {
		return null;
	}

	return result;
}

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

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cwd", {
		description: "Open Pi in another directory via a WezTerm split pane",
		handler: async (args, ctx) => {
			await handleCwdCommand(args, ctx);
		},
	});
}
