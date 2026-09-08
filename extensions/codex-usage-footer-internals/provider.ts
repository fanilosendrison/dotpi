const CODEX_BASE_PROVIDER_ID = "openai-codex";
const CODEX_ALIAS_PREFIX = `${CODEX_BASE_PROVIDER_ID}-`;
const CODEX_ALIAS_SUFFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DISPLAY_SUFFIX_LENGTH = 24;

export interface CodexProviderIdentity {
	providerId: string;
	label: string;
}

function formatAliasSuffix(suffix: string): string {
	if (suffix.length <= MAX_DISPLAY_SUFFIX_LENGTH) return suffix;
	return `${suffix.slice(0, MAX_DISPLAY_SUFFIX_LENGTH - 1)}…`;
}

export function resolveCodexProviderIdentity(
	providerId: string,
): CodexProviderIdentity | undefined {
	if (providerId === CODEX_BASE_PROVIDER_ID) {
		return { providerId, label: "Codex 1" };
	}
	if (!providerId.startsWith(CODEX_ALIAS_PREFIX)) return undefined;

	const suffix = providerId.slice(CODEX_ALIAS_PREFIX.length);
	if (!CODEX_ALIAS_SUFFIX_PATTERN.test(suffix)) return undefined;
	return { providerId, label: `Codex ${formatAliasSuffix(suffix)}` };
}
