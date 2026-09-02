import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	formatCodexUsageStatus,
	formatProgressBar,
	highestCodexUsagePercent,
} from "../../codex-usage-footer-internals/display.ts";
import {
	CodexUsageError,
	extractCodexAccountId,
	parseCodexUsagePayload,
	requestCodexUsage,
	resolveCodexUsageUrl,
} from "../../codex-usage-footer-internals/protocol.ts";

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

function createToken(accountId: string): string {
	const payload = {
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	};
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function validPayload(): Record<string, unknown> {
	return {
		plan_type: "plus",
		rate_limit: {
			allowed: true,
			limit_reached: false,
			primary_window: {
				used_percent: 68,
				limit_window_seconds: 18_000,
				reset_after_seconds: 8_040,
				reset_at: NOW / 1_000 + 8_040,
			},
			secondary_window: {
				used_percent: 31,
				limit_window_seconds: 604_800,
				reset_after_seconds: 259_200,
				reset_at: NOW / 1_000 + 259_200,
			},
		},
	};
}

describe("Codex usage protocol", () => {
	test("extracts the ChatGPT account ID from the OAuth JWT", () => {
		assert.strictEqual(extractCodexAccountId(createToken("account-123")), "account-123");
	});

	test("rejects malformed or incomplete JWTs", () => {
		for (const token of [
			"not-a-jwt",
			"a.invalid payload.c",
			`a.${Buffer.from("{}").toString("base64url")}.c`,
		]) {
			assert.throws(
				() => extractCodexAccountId(token),
				(error: unknown) =>
					error instanceof CodexUsageError && error.kind === "authentication",
			);
		}
	});

	test("builds only the official HTTPS usage URL", () => {
		assert.strictEqual(
			resolveCodexUsageUrl(),
			"https://chatgpt.com/backend-api/wham/usage",
		);
		assert.strictEqual(
			resolveCodexUsageUrl("https://chatgpt.com/backend-api/"),
			"https://chatgpt.com/backend-api/wham/usage",
		);
	});

	test("refuses hostile provider overrides before credentials are sent", () => {
		for (const url of [
			"http://chatgpt.com/backend-api",
			"https://evil.example/backend-api",
			"https://chatgpt.com:8443/backend-api",
			"https://user:pass@chatgpt.com/backend-api",
			"https://chatgpt.com/backend-api?next=evil",
			"https://chatgpt.com/other",
		]) {
			assert.throws(
				() => resolveCodexUsageUrl(url),
				(error: unknown) =>
					error instanceof CodexUsageError && error.kind === "permanent",
			);
		}
	});

	test("parses primary and secondary subscription windows", () => {
		const snapshot = parseCodexUsagePayload(validPayload(), NOW);
		assert.deepStrictEqual(snapshot, {
			capturedAt: NOW,
			planType: "plus",
			primary: {
				usedPercent: 68,
				windowSeconds: 18_000,
				resetsAt: NOW / 1_000 + 8_040,
			},
			secondary: {
				usedPercent: 31,
				windowSeconds: 604_800,
				resetsAt: NOW / 1_000 + 259_200,
			},
		});
	});

	test("accepts an account with no active rate-limit windows", () => {
		assert.deepStrictEqual(parseCodexUsagePayload({ plan_type: "pro", rate_limit: null }, NOW), {
			capturedAt: NOW,
			planType: "pro",
			primary: undefined,
			secondary: undefined,
		});
	});

	test("rejects out-of-range or incomplete window values", () => {
		for (const primaryWindow of [
			{ used_percent: 101, limit_window_seconds: 3_600, reset_at: 1 },
			{ used_percent: 20, limit_window_seconds: 0, reset_at: 1 },
			{ used_percent: 20, limit_window_seconds: 3_600 },
		]) {
			assert.throws(
				() =>
					parseCodexUsagePayload({
						rate_limit: { primary_window: primaryWindow },
					}),
				(error: unknown) => error instanceof CodexUsageError && error.kind === "schema",
			);
		}
	});

	test("requests usage without redirects or caching and sends required auth", async () => {
		let capturedUrl: string | URL | Request | undefined;
		let capturedInit: RequestInit | undefined;
		const snapshot = await requestCodexUsage({
			accessToken: createToken("account-123"),
			accountId: "account-123",
			signal: new AbortController().signal,
			now: () => NOW,
			fetchImplementation: async (url, init) => {
				capturedUrl = url;
				capturedInit = init;
				return new Response(JSON.stringify(validPayload()), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		assert.strictEqual(capturedUrl, "https://chatgpt.com/backend-api/wham/usage");
		assert.strictEqual(capturedInit?.redirect, "error");
		assert.strictEqual(capturedInit?.cache, "no-store");
		const headers = new Headers(capturedInit?.headers);
		assert.strictEqual(headers.get("authorization")?.startsWith("Bearer "), true);
		assert.strictEqual(headers.get("chatgpt-account-id"), "account-123");
		assert.strictEqual(snapshot.primary?.usedPercent, 68);
	});

	test("classifies authentication, transient, and permanent HTTP failures", async () => {
		for (const [status, kind] of [
			[401, "authentication"],
			[429, "transient"],
			[503, "transient"],
			[404, "permanent"],
		] as const) {
			await assert.rejects(
				requestCodexUsage({
					accessToken: createToken("account-123"),
					accountId: "account-123",
					signal: new AbortController().signal,
					fetchImplementation: async () => new Response("", { status }),
				}),
				(error: unknown) => error instanceof CodexUsageError && error.kind === kind,
			);
		}
	});
});

describe("Codex usage footer formatting", () => {
	test("renders fixed-width progress bars", () => {
		assert.strictEqual(formatProgressBar(0), "[░░░░░░░░░░]");
		assert.strictEqual(formatProgressBar(68), "[███████░░░]");
		assert.strictEqual(formatProgressBar(100), "[██████████]");
	});

	test("formats both windows and reset countdowns on one line", () => {
		const snapshot = parseCodexUsagePayload(validPayload(), NOW);
		assert.strictEqual(
			formatCodexUsageStatus(snapshot, { now: NOW }),
			"Codex 5h [███████░░░] 68% ↻2h14 · 1sem [███░░░░░░░] 31% ↻3j",
		);
		assert.strictEqual(highestCodexUsagePercent(snapshot), 68);
	});

	test("marks retained results as stale", () => {
		const snapshot = parseCodexUsagePayload(validPayload(), NOW - 11 * 60_000);
		assert.match(
			formatCodexUsageStatus(snapshot, { now: NOW, stale: true }),
			/ancien 11m$/,
		);
	});
});
