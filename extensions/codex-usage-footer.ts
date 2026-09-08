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
import { resolveCodexProviderIdentity } from "./codex-usage-footer-internals/provider.ts";

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

interface TrailingRefresh {
	generation: number;
	providerId: string;
}

export default function codexUsageFooterExtension(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	let activeProviderId: string | undefined;
	let cachedUsage: Map<string, CachedUsage> | undefined;
	let generation = 0;
	let inFlight: Map<string, InFlightRefresh> | undefined;
	let trailingRefresh: TrailingRefresh | undefined;
	let requestController: AbortController | undefined;
	let refreshInterval: ReturnType<typeof setInterval> | undefined;
	let shutdown = false;

	function getContextProviderId(ctx: ExtensionContext): string | undefined {
		if (!ctx.model?.provider) return undefined;
		return resolveCodexProviderIdentity(ctx.model.provider)?.providerId;
	}

	function setProviderStatus(
		ctx: ExtensionContext,
		providerId: string,
		color: "dim" | "warning",
		message: string,
	): void {
		const identity = resolveCodexProviderIdentity(providerId);
		if (!identity) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg(color, `${identity.label} ${message}`),
		);
	}

	function setLoadingStatus(ctx: ExtensionContext, providerId: string): void {
		setProviderStatus(ctx, providerId, "dim", "quota…");
	}

	function setUnavailableStatus(
		ctx: ExtensionContext,
		providerId: string,
		message = "quota indisponible",
	): void {
		setProviderStatus(ctx, providerId, "warning", message);
	}

	function renderUsageStatus(
		ctx: ExtensionContext,
		providerId: string,
		snapshot: CodexUsageSnapshot,
		stale: boolean,
	): void {
		const identity = resolveCodexProviderIdentity(providerId);
		if (!identity) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const usedPercent = highestCodexUsagePercent(snapshot);
		const color =
			usedPercent >= 90 ? "error" : usedPercent >= 70 ? "warning" : "accent";
		const status = formatCodexUsageStatus(snapshot, {
			label: identity.label,
			stale,
		});
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
		trailingRefresh = undefined;
	}

	function isCurrentRefresh(
		providerId: string,
		refreshGeneration: number,
	): boolean {
		return (
			!shutdown &&
			generation === refreshGeneration &&
			activeProviderId === providerId
		);
	}

	function deactivate(ctx: ExtensionContext, clearCache: boolean): void {
		generation += 1;
		activeContext = undefined;
		activeProviderId = undefined;
		abortCurrentRefresh();
		stopRefreshInterval();
		if (clearCache) cachedUsage = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	}

	function ensureRefreshInterval(): void {
		if (refreshInterval !== undefined) return;
		refreshInterval = setInterval(() => {
			const ctx = activeContext;
			const providerId = activeProviderId;
			if (ctx && providerId) void refreshUsage(ctx, providerId);
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
				renderUsageStatus(ctx, providerId, existing.snapshot, true);
			}
			return;
		}

		cachedUsage?.delete(providerId);
		if (error instanceof CodexUsageError && error.kind === "authentication") {
			setUnavailableStatus(ctx, providerId, "connexion requise");
			return;
		}
		setUnavailableStatus(ctx, providerId);
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

			const existing = cachedUsage?.get(providerId);
			if (existing?.accountId === accountId) {
				renderUsageStatus(ctx, providerId, existing.snapshot, existing.stale);
			} else if (existing) {
				cachedUsage?.delete(providerId);
				setLoadingStatus(ctx, providerId);
			}

			const provider = ctx.modelRegistry.getProvider(providerId);
			const snapshot = await requestCodexUsage({
				accessToken,
				accountId,
				baseUrl: authResult?.auth.baseUrl ?? provider?.baseUrl,
				signal: controller.signal,
			});
			if (!isCurrentRefresh(providerId, refreshGeneration)) return;

			if (!cachedUsage) cachedUsage = new Map();
			cachedUsage.set(providerId, { accountId, snapshot, stale: false });
			renderUsageStatus(ctx, providerId, snapshot, false);
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
		queueAfterCurrent = false,
	): Promise<void> {
		if (
			ctx.mode !== "tui" ||
			activeProviderId !== providerId ||
			shutdown
		) {
			return Promise.resolve();
		}
		const refreshGeneration = generation;

		const existingRefresh = inFlight?.get(providerId);
		if (existingRefresh?.generation === refreshGeneration) {
			if (queueAfterCurrent) {
				trailingRefresh = { generation: refreshGeneration, providerId };
			}
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
			const runTrailingRefresh =
				trailingRefresh?.providerId === providerId &&
				trailingRefresh.generation === refreshGeneration &&
				isCurrentRefresh(providerId, refreshGeneration);
			if (
				trailingRefresh?.providerId === providerId &&
				trailingRefresh.generation === refreshGeneration
			) {
				trailingRefresh = undefined;
			}
			if (inFlight?.get(providerId)?.generation === refreshGeneration) {
				inFlight.delete(providerId);
			}
			if (requestController === controller) requestController = undefined;

			const ctxForTrailingRefresh = activeContext;
			if (runTrailingRefresh && ctxForTrailingRefresh) {
				void refreshUsage(ctxForTrailingRefresh, providerId);
			}
		});

		if (!inFlight) inFlight = new Map();
		inFlight.set(providerId, { generation: refreshGeneration, promise });
		return promise;
	}

	function activate(ctx: ExtensionContext, providerId: string): void {
		if (!resolveCodexProviderIdentity(providerId)) {
			deactivate(ctx, true);
			return;
		}

		generation += 1;
		abortCurrentRefresh();
		activeContext = ctx;
		activeProviderId = providerId;
		ensureRefreshInterval();
		setLoadingStatus(ctx, providerId);
		void refreshUsage(ctx, providerId);
	}

	pi.on("session_start", (_event, ctx) => {
		shutdown = false;
		const providerId = ctx.mode === "tui" ? getContextProviderId(ctx) : undefined;
		if (providerId) activate(ctx, providerId);
		else deactivate(ctx, true);
	});

	pi.on("model_select", (event, ctx) => {
		const providerId =
			ctx.mode === "tui"
				? resolveCodexProviderIdentity(event.model.provider)?.providerId
				: undefined;
		if (providerId) activate(ctx, providerId);
		else deactivate(ctx, true);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const providerId = activeProviderId;
		if (ctx.mode === "tui" && providerId) {
			activeContext = ctx;
			void refreshUsage(ctx, providerId, true);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		shutdown = true;
		deactivate(ctx, true);
	});
}
