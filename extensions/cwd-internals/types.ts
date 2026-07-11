import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

export const SPLIT_TYPES = [
	"--bottom",
	"--top",
	"--right",
	"--left",
	"--horizontal",
	"--vertical",
	"--tab",
] as const;

export const INVALID_SPLIT_TYPE_MESSAGE =
	"Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab";

export type SplitType = (typeof SPLIT_TYPES)[number];

export type ParsedCwdArgs =
	| {
			ok: true;
			splitType: SplitType;
			directoryArgument: string;
	  }
	| {
			ok: false;
			message: string;
	  };

export type CwdCommandContext = {
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

export type CwdCommandDependencies = {
	directoryExists: (directory: string) => boolean;
	runWezTerm: (args: string[]) => void;
};
