import { type Dirent, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const BROWSER_HELP_LINE = "↑↓ navigate · ↵ enter · ⌫ back · esc cancel";

function isRootPath(path: string): boolean {
	return dirname(path) === path;
}

export class DirectoryBrowser {
	private currentPath: string;
	private entries: Dirent[] = [];
	private selectedIndex = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly theme: Theme;

	public onSelect?: (path: string) => void;
	public onCancel?: () => void;

	constructor(startPath: string, theme: Theme) {
		this.theme = theme;
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

	private renderItem(
		text: string,
		index: number,
		width: number,
		style?: (line: string) => string,
	): string {
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
			lines.push(
				this.renderItem("..", index, width, (line) =>
					this.theme.fg("muted", line),
				),
			);
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

		const border =
			new DynamicBorder((s: string) => this.theme.fg("border", s)).render(
				width,
			)[0] ?? "";
		const lines = [
			border,
			truncateToWidth(
				`  ${this.theme.fg("accent", this.theme.bold("Navigate to directory"))}`,
				width,
			),
			"",
			truncateToWidth(
				`  ${this.theme.fg("muted", `📁 ${this.currentPath}`)}`,
				width,
			),
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
