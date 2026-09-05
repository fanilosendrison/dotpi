import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import codexUsageFooterExtension from "../../codex-usage-footer.ts";

const NOW_SECONDS = Math.floor(Date.now() / 1_000);

type ExtensionHandler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => Promise<unknown> | unknown;

type HandlerRegistry = Record<string, ExtensionHandler[]>;

interface TestRuntime {
	context: ExtensionContext;
	handlers: HandlerRegistry;
	statuses: Array<string | undefined>;
	setProvider(provider: string): void;
	setMode(mode: "tui" | "json"): void;
	setAccessToken(token: string | undefined): void;
	setModel(provider: string, id: string): void;
}

function createToken(accountId: string): string {
	const payload = {
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	};
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function usageResponse(usedPercent = 42): Response {
	return new Response(
		JSON.stringify({
			plan_type: "plus",
			rate_limit: {
				primary_window: {
					used_percent: usedPercent,
					limit_window_seconds: 18_000,
					reset_after_seconds: 3_600,
					reset_at: NOW_SECONDS + 3_600,
				},
				secondary_window: null,
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function createRuntime(
	provider = "openai-codex",
	modelId = "gpt-5.4",
): TestRuntime {
	const handlers: HandlerRegistry = {};
	const statuses: Array<string | undefined> = [];
	let activeProvider = provider;
	let activeMode: "tui" | "json" = "tui";
	let accessToken: string | undefined = createToken("account-a");
	let activeModelId = modelId;

	const context = {
		get mode() {
			return activeMode;
		},
		get model() {
			return { provider: activeProvider, id: activeModelId };
		},
		ui: {
			theme: {
				fg: (color: string, text: string) => `${color}:${text}`,
			},
			setStatus: (key: string, text: string | undefined) => {
				assert.strictEqual(key, "codex-usage");
				statuses.push(text);
			},
		},
		modelRegistry: {
			getProviderAuth: async (providerId: string) =>
				accessToken
					? { auth: { apiKey: accessToken }, source: "OAuth" }
					: undefined,
			getProvider: (providerId: string) => ({
				baseUrl: "https://chatgpt.com/backend-api",
			}),
		},
	} as unknown as ExtensionContext;

	const pi = {
		on: (event: string, handler: ExtensionHandler) => {
			handlers[event] = [...(handlers[event] ?? []), handler];
		},
	} as unknown as ExtensionAPI;
	codexUsageFooterExtension(pi);

	return {
		context,
		handlers,
		statuses,
		setProvider: (nextProvider) => {
			activeProvider = nextProvider;
		},
		setMode: (nextMode) => {
			activeMode = nextMode;
		},
		setAccessToken: (token) => {
			accessToken = token;
		},
		setModel: (provider: string, id: string) => {
			activeProvider = provider;
			activeModelId = id;
		},
	};
}

async function trigger(
	runtime: TestRuntime,
	eventName: string,
	event: Record<string, unknown> = {},
): Promise<void> {
	for (const handler of runtime.handlers[eventName] ?? []) {
		await handler(event, runtime.context);
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	assert.fail("Timed out waiting for asynchronous extension state");
}

function latestStatus(runtime: TestRuntime): string | undefined {
	return runtime.statuses.at(-1);
}

describe("Codex usage footer extension", () => {
	const originalFetch = globalThis.fetch;
	let runtime: TestRuntime | undefined;

	beforeEach(() => {
		runtime = undefined;
	});

	afterEach(async () => {
		if (runtime) await trigger(runtime, "session_shutdown");
		globalThis.fetch = originalFetch;
	});

	test("registers all required lifecycle handlers", () => {
		runtime = createRuntime();
		assert.deepStrictEqual(Object.keys(runtime.handlers).sort(), [
			"agent_settled",
			"model_select",
			"session_shutdown",
			"session_start",
		]);
	});

	test("shows both a loading state and the fetched quota for OpenAI Codex", async () => {
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return usageResponse(42);
		};
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		assert.match(runtime.statuses[0] ?? "", /Codex quota…/);
		await waitFor(() => latestStatus(runtime!)?.includes("42%") === true);
		assert.strictEqual(fetchCalls, 1);
		assert.match(latestStatus(runtime) ?? "", /\[████░░░░░░\]/);
	});

	test("shows quota for openai-codex-2 alias provider", async () => {
		let fetchCalls = 0;
		let capturedProviderId: string | undefined;

		globalThis.fetch = async () => {
			fetchCalls += 1;
			return usageResponse(65);
		};

		runtime = createRuntime("openai-codex-2");
		const modelRegistry = runtime.context.modelRegistry;
		const originalGetProviderAuth = modelRegistry.getProviderAuth;
		modelRegistry.getProviderAuth = async (providerId: string) => {
			capturedProviderId = providerId;
			return originalGetProviderAuth.call(modelRegistry, providerId);
		};

		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("65%") === true);
		assert.strictEqual(fetchCalls, 1);
		assert.strictEqual(capturedProviderId, "openai-codex-2");
	});

	test("stays inactive for API-key OpenAI and non-TUI modes", async () => {
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return usageResponse();
		};
		runtime = createRuntime("openai");

		await trigger(runtime, "session_start");
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(latestStatus(runtime), undefined);

		runtime.setProvider("openai-codex");
		runtime.setMode("json");
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex", id: "gpt-5.4" },
		});
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(latestStatus(runtime), undefined);
	});

	test("stays inactive for non-Codex providers", async () => {
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return usageResponse();
		};
		runtime = createRuntime("anthropic");

		await trigger(runtime, "session_start");
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(latestStatus(runtime), undefined);
	});

	test("stays inactive for a provider that only shares the Codex prefix", async () => {
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return usageResponse();
		};
		runtime = createRuntime("openai-codexish");

		await trigger(runtime, "session_start");
		assert.strictEqual(fetchCalls, 0);
		assert.strictEqual(latestStatus(runtime), undefined);
	});

	test("deduplicates concurrent refresh requests for same provider", async () => {
		let resolveResponse: ((response: Response) => void) | undefined;
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return new Promise<Response>((resolve) => {
				resolveResponse = resolve;
			});
		};
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		await trigger(runtime, "agent_settled");
		await trigger(runtime, "agent_settled");
		await waitFor(() => fetchCalls === 1);
		resolveResponse?.(usageResponse());
		await waitFor(() => latestStatus(runtime!)?.includes("42%") === true);
		assert.strictEqual(fetchCalls, 1);
	});

	test("a stale refresh cannot remove a newer in-flight refresh", async () => {
		const resolvers: Array<(response: Response) => void> = [];
		let fetchCalls = 0;
		globalThis.fetch = async () => {
			fetchCalls += 1;
			return new Promise<Response>((resolve) => {
				resolvers.push(resolve);
			});
		};
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		await waitFor(() => fetchCalls === 1);
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex", id: "gpt-5.4" },
		});
		await waitFor(() => fetchCalls === 2);

		resolvers[0]?.(usageResponse(10));
		await new Promise((resolve) => setTimeout(resolve, 0));
		await trigger(runtime, "agent_settled");
		assert.strictEqual(fetchCalls, 2);

		resolvers[1]?.(usageResponse(60));
		await waitFor(() => latestStatus(runtime!)?.includes("60%") === true);
	});

	test("does not restore Codex status after switching providers mid-request", async () => {
		let resolveResponse: ((response: Response) => void) | undefined;
		globalThis.fetch = async () =>
			new Promise<Response>((resolve) => {
				resolveResponse = resolve;
			});
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		await waitFor(() => resolveResponse !== undefined);
		runtime.setProvider("anthropic");
		await trigger(runtime, "model_select", {
			model: { provider: "anthropic", id: "claude" },
		});
		assert.strictEqual(latestStatus(runtime), undefined);

		resolveResponse?.(usageResponse(77));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.strictEqual(latestStatus(runtime), undefined);
	});

	test("retains same-account data as visibly stale on transient failures", async () => {
		const responses = [usageResponse(55), new Response("", { status: 503 })];
		globalThis.fetch = async () => responses.shift() ?? usageResponse(55);
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("55%") === true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await trigger(runtime, "agent_settled");
		await waitFor(() => latestStatus(runtime!)?.includes("ancien") === true);
		assert.match(latestStatus(runtime) ?? "", /55%/);

		globalThis.fetch = async () => new Promise<Response>(() => {});
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex", id: "gpt-5.5" },
		});
		assert.match(latestStatus(runtime) ?? "", /ancien/);
	});

	test("clears prior-account data before displaying a new account", async () => {
		const responses = [usageResponse(20), usageResponse(80)];
		globalThis.fetch = async () => responses.shift() ?? usageResponse(80);
		runtime = createRuntime();

		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("20%") === true);
		runtime.setAccessToken(createToken("account-b"));
		await trigger(runtime, "agent_settled");
		await waitFor(() => latestStatus(runtime!)?.includes("80%") === true);

		const secondLoadingIndex = runtime.statuses.findIndex(
			(status, index) => index > 0 && status?.includes("Codex quota…") === true,
		);
		assert.notStrictEqual(secondLoadingIndex, -1);
	});

	test("shows an authentication state and clears it on shutdown", async () => {
		globalThis.fetch = async () => usageResponse();
		runtime = createRuntime();
		runtime.setAccessToken(undefined);

		await trigger(runtime, "session_start");
		await waitFor(
			() => latestStatus(runtime!)?.includes("connexion requise") === true,
		);
		await trigger(runtime, "session_shutdown");
		assert.strictEqual(latestStatus(runtime), undefined);
		runtime = undefined;
	});

	test("cache is isolated per provider - switching from openai-codex to openai-codex-2", async () => {
		const responses = [
			usageResponse(25), // openai-codex
			usageResponse(75), // openai-codex-2
		];
		globalThis.fetch = async () => responses.shift() ?? usageResponse(50);

		runtime = createRuntime("openai-codex");
		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("25%") === true);

		// Switch to openai-codex-2
		runtime.setProvider("openai-codex-2");
		runtime.setModel("openai-codex-2", "gpt-5.4");
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex-2", id: "gpt-5.4" },
		});

		// Should show loading state, not the cached 25% from openai-codex
		assert.match(latestStatus(runtime) ?? "", /Codex quota…/);

		// Wait for the new quota to load
		await waitFor(() => latestStatus(runtime!)?.includes("75%") === true);
		assert.match(latestStatus(runtime) ?? "", /75%/);
		assert.ok((latestStatus(runtime) ?? "").includes("75%"));
	});

	test("cache is isolated per provider - switching back to original provider", async () => {
		const responses = [
			usageResponse(30), // openai-codex
			usageResponse(80), // openai-codex-2
			usageResponse(30), // openai-codex again (should use cache if still valid)
		];
		globalThis.fetch = async () => responses.shift() ?? usageResponse(50);

		runtime = createRuntime("openai-codex");
		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("30%") === true);

		// Switch to openai-codex-2
		runtime.setProvider("openai-codex-2");
		runtime.setModel("openai-codex-2", "gpt-5.4");
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex-2", id: "gpt-5.4" },
		});
		await waitFor(() => latestStatus(runtime!)?.includes("80%") === true);

		// Switch back to openai-codex
		runtime.setProvider("openai-codex");
		runtime.setModel("openai-codex", "gpt-5.4");
		await trigger(runtime, "model_select", {
			model: { provider: "openai-codex", id: "gpt-5.4" },
		});

		// Should show the cached 30% for openai-codex, not the 80% from openai-codex-2
		await waitFor(() => latestStatus(runtime!)?.includes("30%") === true);
		assert.match(latestStatus(runtime) ?? "", /30%/);
	});

	test("account change invalidates cache for that provider", async () => {
		const responses = [
			usageResponse(40), // account-a on openai-codex
			usageResponse(90), // account-b on openai-codex (different account)
		];
		globalThis.fetch = async () => responses.shift() ?? usageResponse(50);

		runtime = createRuntime("openai-codex");
		await trigger(runtime, "session_start");
		await waitFor(() => latestStatus(runtime!)?.includes("40%") === true);

		// Change to a different account for the same provider
		runtime.setAccessToken(createToken("account-b"));
		await trigger(runtime, "agent_settled");

		// Should show loading state because account changed
		assert.match(latestStatus(runtime) ?? "", /Codex quota…/);

		// Wait for new quota
		await waitFor(() => latestStatus(runtime!)?.includes("90%") === true);
	});
});
