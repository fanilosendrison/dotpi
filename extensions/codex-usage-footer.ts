import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	formatCodexUsageStatus,
	highestCodexUsagePercent,
} from "./codex-usage-footer-internals/display.ts";
import {
	CodexUsageError,
	extractCodexAccountId,
	requestCodexUsage,
	type CodexUsageSnapshot,
} from "./codex-usage-footer-internals/protocol.ts";

const CODEX_BASE_PROVIDER_ID = "openai-codex";
const STATUS_KEY = "codex-usage";
const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface CachedUsage {
	accountId: string;
	snapshot: CodexUsageSnapshot;
	stale: boolean;
}

interface InFlightRefresh {
	generation: number;
	promise: Promise<void>;
}

/**
 * Check if a provider ID represents a Codex provider (base or alias).
 * Pi multi-login creates aliases with the pattern: `${base}-${suffix}`
 * So openai-codex aliases will be "openai-codex-2", "openai-codex-work", etc.
 */
function isCodexProvider(providerId: string): boolean {
	return (
		providerId === CODEX_BASE_PROVIDER_ID ||
		providerId.startsWith(`${CODEX_BASE_PROVIDER_ID}-`)
	);
}

/**
 * Get the actual provider ID to use for auth/provider lookups.
 * For Codex providers, this is the exact provider ID (including aliases).
 */
function getCodexProviderId(providerId: string): string | undefined {
	if (!isCodexProvider(providerId)) return undefined;
	return providerId;
}

export default function codexUsageFooterExtension(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	// Cache keyed by provider ID
	let cachedUsage: Map<string, CachedUsage> | undefined;
	let generation = 0;
	let inFlight: Map<string, InFlightRefresh> | undefined;
	let requestController: AbortController | undefined;
	let refreshInterval: ReturnType<typeof setInterval> | undefined;
	let shutdown = false;

	function isCodexContext(ctx: ExtensionContext): boolean {
		return (
			ctx.mode === "tui" &&
			ctx.model?.provider !== undefined &&
			getCodexProviderId(ctx.model.provider) !== undefined
		);
	}

	function getActiveProviderId(ctx: ExtensionContext): string | undefined {
		if (!ctx.model?.provider) return undefined;
		return getCodexProviderId(ctx.model.provider);
	}

	function setUnavailableStatus(
		ctx: ExtensionContext,
		message = "Codex quota indisponible",
	): void {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", message));
	}

	function renderUsageStatus(
		ctx: ExtensionContext,
		snapshot: CodexUsageSnapshot,
		stale: boolean,
	): void {
		const usedPercent = highestCodexUsagePercent(snapshot);
		const color =
			usedPercent >= 90 ? "error" : usedPercent >= 70 ? "warning" : "accent";
		const status = formatCodexUsageStatus(snapshot, { stale });
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, status));
	}

	function stopRefreshInterval(): void {
		if (refreshInterval === undefined) return;
		clearInterval(refreshInterval);
		refreshInterval = undefined;
	}

	function abortCurrentRefresh(): void {
		requestController?.abort();
		requestController = undefined;
		inFlight = undefined;
	}

	function isCurrentRefresh(
		providerId: string,
		refreshGeneration: number,
	): boolean {
		const activeProviderId = activeContext
			? getActiveProviderId(activeContext)
			: undefined;
		return (
			!shutdown &&
			generation === refreshGeneration &&
			activeProviderId === providerId
		);
	}

	function deactivate(ctx: ExtensionContext, clearCache: boolean): void {
		generation += 1;
		activeContext = undefined;
		abortCurrentRefresh();
		stopRefreshInterval();
		if (clearCache) cachedUsage = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function ensureRefreshInterval(): void {
		if (refreshInterval !== undefined) return;
		refreshInterval = setInterval(() => {
			const ctx = activeContext;
			if (ctx && isCodexContext(ctx)) {
				const providerId = getActiveProviderId(ctx);
				if (providerId) void refreshUsage(ctx, providerId);
			}
		}, REFRESH_INTERVAL_MS);
		refreshInterval.unref?.();
	}

	function handleRefreshFailure(
		ctx: ExtensionContext,
		error: unknown,
		providerId: string,
		accountId: string | undefined,
	): void {
		const transient =
			!(error instanceof CodexUsageError) || error.kind === "transient";
		if (
			transient &&
			accountId !== undefined &&
			cachedUsage?.get(providerId)?.accountId === accountId
		) {
			const existing = cachedUsage.get(providerId);
			if (existing) {
				cachedUsage.set(providerId, { ...existing, stale: true });
				renderUsageStatus(ctx, existing.snapshot, true);
			}
			return;
		}

		cachedUsage?.delete(providerId);
		if (error instanceof CodexUsageError && error.kind === "authentication") {
			setUnavailableStatus(ctx, "Codex connexion requise");
			return;
		}
		setUnavailableStatus(ctx);
	}

	async function performRefresh(
		ctx: ExtensionContext,
		providerId: string,
		refreshGeneration: number,
		controller: AbortController,
	): Promise<void> {
		let accountId: string | undefined;
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		timeout.unref?.();

		try {
			const authResult = await ctx.modelRegistry.getProviderAuth(providerId);
			if (!isCurrentRefresh(providerId, refreshGeneration)) return;
			const accessToken = authResult?.auth.apiKey;
			if (!accessToken) {
				throw new CodexUsageError(
					"authentication",
					"Codex OAuth token is unavailable",
				);
			}

			accountId = extractCodexAccountId(accessToken);
			if (!isCurrentRefresh(providerId, refreshGeneration)) return;

			// Invalidate cache if account ID changed for this provider
			const existing = cachedUsage?.get(providerId);
			if (existing && existing.accountId !== accountId) {
				cachedUsage?.delete(providerId);
				ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "Codex quota…"));
			}

			const provider = ctx.modelRegistry.getProvider(providerId);
			const snapshot = await requestCodexUsage({
				accessToken,
				accountId,
				baseUrl: authResult?.auth.baseUrl ?? provider?.baseUrl,
				signal: controller.signal,
			});
			if (!isCurrentRefresh(providerId, refreshGeneration)) return;

			if (!cachedUsage) {
				cachedUsage = new Map();
			}
			cachedUsage.set(providerId, { accountId, snapshot, stale: false });
			renderUsageStatus(ctx, snapshot, false);
		} catch (error) {
			if (!isCurrentRefresh(providerId, refreshGeneration)) return;
			handleRefreshFailure(ctx, error, providerId, accountId);
		} finally {
			clearTimeout(timeout);
		}
	}

	function refreshUsage(
		ctx: ExtensionContext,
		providerId: string,
	): Promise<void> {
		if (!isCodexContext(ctx) || shutdown) return Promise.resolve();
		const refreshGeneration = generation;

		// Check if there's already an in-flight refresh for this provider
		const existingRefresh = inFlight?.get(providerId);
		if (existingRefresh?.generation === refreshGeneration) {
			return existingRefresh.promise;
		}

		const controller = new AbortController();
		requestController = controller;
		const promise = performRefresh(
			ctx,
			providerId,
			refreshGeneration,
			controller,
		).finally(() => {
			if (inFlight?.get(providerId)?.generation === refreshGeneration) {
				inFlight.delete(providerId);
			}
			if (requestController === controller) requestController = undefined;
		});

		if (!inFlight) {
			inFlight = new Map();
		}
		inFlight.set(providerId, { generation: refreshGeneration, promise });
		return promise;
	}

	function activate(ctx: ExtensionContext): void {
		generation += 1;
		abortCurrentRefresh();
		activeContext = ctx;
		ensureRefreshInterval();

		const providerId = getActiveProviderId(ctx);
		if (!providerId) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const existing = cachedUsage?.get(providerId);
		if (existing) {
			renderUsageStatus(ctx, existing.snapshot, existing.stale);
		} else {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "Codex quota…"));
		}
		void refreshUsage(ctx, providerId);
	}

	pi.on("session_start", (_event, ctx) => {
		shutdown = false;
		if (isCodexContext(ctx)) {
			const providerId = getActiveProviderId(ctx);
			if (providerId) activate(ctx);
			else deactivate(ctx, true);
		} else {
			deactivate(ctx, true);
		}
	});

	pi.on("model_select", (event, ctx) => {
		if (ctx.mode === "tui") {
			const providerId = getActiveProviderId(ctx);
			if (providerId && event.model.provider === ctx.model?.provider) {
				activate(ctx);
			} else {
				deactivate(ctx, true);
			}
		} else {
			deactivate(ctx, true);
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (isCodexContext(ctx)) {
			const providerId = getActiveProviderId(ctx);
			if (providerId) void refreshUsage(ctx, providerId);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		shutdown = true;
		deactivate(ctx, true);
	});
}
