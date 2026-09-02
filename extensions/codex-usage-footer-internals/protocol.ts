const OFFICIAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_AUTH_CLAIM = "https://api.openai.com/auth";
const MAX_JWT_PAYLOAD_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type CodexUsageErrorKind =
	| "authentication"
	| "transient"
	| "permanent"
	| "schema";

export class CodexUsageError extends Error {
	readonly kind: CodexUsageErrorKind;

	constructor(kind: CodexUsageErrorKind, message: string) {
		super(message);
		this.name = "CodexUsageError";
		this.kind = kind;
	}
}

export interface CodexUsageWindow {
	usedPercent: number;
	windowSeconds: number;
	resetsAt: number;
}

export interface CodexUsageSnapshot {
	capturedAt: number;
	planType?: string;
	primary?: CodexUsageWindow;
	secondary?: CodexUsageWindow;
}

interface RequestCodexUsageOptions {
	accessToken: string;
	accountId: string;
	baseUrl?: string;
	signal: AbortSignal;
	fetchImplementation?: typeof fetch;
	now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractCodexAccountId(accessToken: string): string {
	const segments = accessToken.split(".");
	if (segments.length !== 3) {
		throw new CodexUsageError("authentication", "Codex access token is not a JWT");
	}

	const payloadSegment = segments[1];
	if (
		!payloadSegment ||
		payloadSegment.length > MAX_JWT_PAYLOAD_BYTES * 2 ||
		!/^[A-Za-z0-9_-]+$/.test(payloadSegment)
	) {
		throw new CodexUsageError("authentication", "Codex JWT payload is invalid");
	}

	let payload: unknown;
	try {
		const decoded = Buffer.from(payloadSegment, "base64url");
		if (decoded.byteLength > MAX_JWT_PAYLOAD_BYTES) {
			throw new Error("JWT payload is too large");
		}
		payload = JSON.parse(decoded.toString("utf8")) as unknown;
	} catch {
		throw new CodexUsageError("authentication", "Codex JWT payload cannot be decoded");
	}

	if (!isRecord(payload)) {
		throw new CodexUsageError("authentication", "Codex JWT payload is not an object");
	}
	const authClaim = payload[CODEX_AUTH_CLAIM];
	if (!isRecord(authClaim)) {
		throw new CodexUsageError("authentication", "Codex JWT auth claim is missing");
	}
	const accountId = authClaim.chatgpt_account_id;
	if (typeof accountId !== "string" || accountId.trim().length === 0) {
		throw new CodexUsageError("authentication", "Codex account ID is missing");
	}
	return accountId.trim();
}

export function resolveCodexUsageUrl(baseUrl = OFFICIAL_CODEX_BASE_URL): string {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new CodexUsageError("permanent", "Codex provider URL is invalid");
	}

	const normalizedPath = parsed.pathname.replace(/\/+$/, "");
	const isOfficialEndpoint =
		parsed.protocol === "https:" &&
		parsed.hostname === "chatgpt.com" &&
		parsed.port === "" &&
		parsed.username === "" &&
		parsed.password === "" &&
		parsed.search === "" &&
		parsed.hash === "" &&
		normalizedPath === "/backend-api";
	if (!isOfficialEndpoint) {
		throw new CodexUsageError(
			"permanent",
			"Refusing to send Codex credentials to an unexpected endpoint",
		);
	}

	parsed.pathname = `${normalizedPath}/wham/usage`;
	return parsed.toString();
}

function parseUsageWindow(value: unknown, fieldName: string): CodexUsageWindow | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) {
		throw new CodexUsageError("schema", `${fieldName} is not an object`);
	}

	const usedPercent = value.used_percent;
	const windowSeconds = value.limit_window_seconds;
	const resetsAt = value.reset_at;
	if (
		typeof usedPercent !== "number" ||
		!Number.isFinite(usedPercent) ||
		usedPercent < 0 ||
		usedPercent > 100 ||
		typeof windowSeconds !== "number" ||
		!Number.isInteger(windowSeconds) ||
		windowSeconds <= 0 ||
		typeof resetsAt !== "number" ||
		!Number.isInteger(resetsAt) ||
		resetsAt <= 0
	) {
		throw new CodexUsageError("schema", `${fieldName} contains invalid values`);
	}

	return { usedPercent, windowSeconds, resetsAt };
}

export function parseCodexUsagePayload(
	payload: unknown,
	capturedAt = Date.now(),
): CodexUsageSnapshot {
	if (!isRecord(payload)) {
		throw new CodexUsageError("schema", "Codex usage payload is not an object");
	}

	const planTypeValue = payload.plan_type;
	if (
		planTypeValue !== undefined &&
		(typeof planTypeValue !== "string" || planTypeValue.trim().length === 0)
	) {
		throw new CodexUsageError("schema", "Codex plan type is invalid");
	}

	const rateLimitValue = payload.rate_limit;
	if (rateLimitValue !== undefined && rateLimitValue !== null && !isRecord(rateLimitValue)) {
		throw new CodexUsageError("schema", "Codex rate limit is invalid");
	}
	const rateLimit = isRecord(rateLimitValue) ? rateLimitValue : undefined;

	return {
		capturedAt,
		...(typeof planTypeValue === "string" ? { planType: planTypeValue.trim() } : {}),
		primary: parseUsageWindow(rateLimit?.primary_window, "primary_window"),
		secondary: parseUsageWindow(rateLimit?.secondary_window, "secondary_window"),
	};
}

async function readResponseBody(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new CodexUsageError("schema", "Codex usage response is too large");
	}
	if (!response.body) {
		throw new CodexUsageError("schema", "Codex usage response has no body");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parts: string[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new CodexUsageError("schema", "Codex usage response is too large");
			}
			parts.push(decoder.decode(value, { stream: true }));
		}
		parts.push(decoder.decode());
		return parts.join("");
	} finally {
		reader.releaseLock();
	}
}

function errorKindForStatus(status: number): CodexUsageErrorKind {
	if (status === 401 || status === 403) return "authentication";
	if (status === 408 || status === 429 || status >= 500) return "transient";
	return "permanent";
}

export async function requestCodexUsage(
	options: RequestCodexUsageOptions,
): Promise<CodexUsageSnapshot> {
	const endpoint = resolveCodexUsageUrl(options.baseUrl);
	const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
	const response = await fetchImplementation(endpoint, {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${options.accessToken}`,
			"ChatGPT-Account-Id": options.accountId,
		},
		cache: "no-store",
		redirect: "error",
		signal: options.signal,
	});

	if (!response.ok) {
		throw new CodexUsageError(
			errorKindForStatus(response.status),
			`Codex usage request failed with status ${response.status}`,
		);
	}

	const responseBody = await readResponseBody(response);
	let payload: unknown;
	try {
		payload = JSON.parse(responseBody) as unknown;
	} catch {
		throw new CodexUsageError("schema", "Codex usage response is not valid JSON");
	}
	return parseCodexUsagePayload(payload, options.now?.() ?? Date.now());
}
