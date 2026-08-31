import {
	INVALID_SPLIT_TYPE_MESSAGE,
	type ParsedCwdArgs,
	SPLIT_TYPES,
	type SplitType,
} from "./types.ts";

export function isSplitType(value: string): value is SplitType {
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
