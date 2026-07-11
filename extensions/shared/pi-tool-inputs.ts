export type ExtractedPathType = "string" | "array" | "patch";

export interface ExtractedPath {
	field: string;
	type: ExtractedPathType;
	index?: number;
	path: string;
}

export interface CollectPathFieldsOptions {
	stringFields: readonly string[];
	arrayFields?: readonly string[];
	patchFields?: readonly string[];
	collectPatchPaths?: (patchText: string) => readonly string[];
}

export const READ_PATH_FIELDS = ["path", "file_path", "AbsolutePath"] as const;

export function getFirstStringField(
	input: Record<string, unknown>,
	fields: readonly string[],
): string | null {
	for (const field of fields) {
		const value = input[field];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

export function getReadPath(input: Record<string, unknown>): string | null {
	return getFirstStringField(input, READ_PATH_FIELDS);
}

export function collectPathFields(
	input: Record<string, unknown>,
	options: CollectPathFieldsOptions,
): ExtractedPath[] {
	const results: ExtractedPath[] = [];

	for (const field of options.stringFields) {
		const value = input[field];
		if (typeof value === "string" && value.length > 0) {
			results.push({ field, type: "string", path: value });
		}
	}

	for (const field of options.arrayFields ?? []) {
		const values = input[field];
		if (!Array.isArray(values)) continue;

		for (let index = 0; index < values.length; index++) {
			const value = values[index];
			if (typeof value === "string" && value.length > 0) {
				results.push({ field, type: "array", index, path: value });
			}
		}
	}

	if (!options.collectPatchPaths) return results;

	for (const field of options.patchFields ?? []) {
		const patchText = input[field];
		if (typeof patchText !== "string" || patchText.length === 0) continue;

		for (const path of options.collectPatchPaths(patchText)) {
			results.push({ field, type: "patch", path });
		}
	}

	return results;
}

export function replaceExtractedPath(
	input: Record<string, unknown>,
	extracted: ExtractedPath,
	replacement: string,
): void {
	if (extracted.type === "string") {
		input[extracted.field] = replacement;
		return;
	}

	if (extracted.type === "array" && typeof extracted.index === "number") {
		const values = input[extracted.field];
		if (Array.isArray(values)) {
			values[extracted.index] = replacement;
		}
		return;
	}

	const patchText = input[extracted.field];
	if (typeof patchText === "string") {
		input[extracted.field] = patchText.split(extracted.path).join(replacement);
	}
}
