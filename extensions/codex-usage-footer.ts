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

const CODEX_PROVIDER_ID = "openai-codex";
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

export default function codexUsageFooterExtension(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	let cachedUsage: CachedUsage | undefined;
	let generation = 0;
	let inFlight: InFlightRefresh | undefined;
	let requestController: AbortController | undefined;
	let refreshInterval: ReturnType<typeof setInterval> | undefined;
	let shutdown = false;

	function isCodexContext(ctx: ExtensionContext): boolean {
		return ctx.mode === "tui" && ctx.model?.provider === CODEX_PROVIDER_ID;
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
		const color = usedPercent >= 90 ? "error" : usedPercent >= 70 ? "warning" : "accent";
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

	function isCurrentRefresh(refreshGeneration: number): boolean {
		return !shutdown && generation === refreshGeneration;
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
			if (ctx && isCodexContext(ctx)) void refreshUsage(ctx);
		}, REFRESH_INTERVAL_MS);
		refreshInterval.unref?.();
	}

	function handleRefreshFailure(
		ctx: ExtensionContext,
		error: unknown,
		accountId: string | undefined,
	): void {
		const transient =
			!(error instanceof CodexUsageError) || error.kind === "transient";
		if (
			transient &&
			accountId !== undefined &&
			cachedUsage?.accountId === accountId
		) {
			cachedUsage = { ...cachedUsage, stale: true };
			renderUsageStatus(ctx, cachedUsage.snapshot, cachedUsage.stale);
			return;
		}

		cachedUsage = undefined;
		if (error instanceof CodexUsageError && error.kind === "authentication") {
			setUnavailableStatus(ctx, "Codex connexion requise");
			return;
		}
		setUnavailableStatus(ctx);
	}

	async function performRefresh(
		ctx: ExtensionContext,
		refreshGeneration: number,
		controller: AbortController,
	): Promise<void> {
		let accountId: string | undefined;
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		timeout.unref?.();

		try {
			const authResult = await ctx.modelRegistry.getProviderAuth(CODEX_PROVIDER_ID);
			if (!isCurrentRefresh(refreshGeneration)) return;
			const accessToken = authResult?.auth.apiKey;
			if (!accessToken) {
				throw new CodexUsageError("authentication", "Codex OAuth token is unavailable");
			}

			accountId = extractCodexAccountId(accessToken);
			if (!isCurrentRefresh(refreshGeneration)) return;
			if (cachedUsage && cachedUsage.accountId !== accountId) {
				cachedUsage = undefined;
				ctx.ui.setStatus(
					STATUS_KEY,
					ctx.ui.theme.fg("dim", "Codex quota…"),
				);
			}

			const provider = ctx.modelRegistry.getProvider(CODEX_PROVIDER_ID);
			const snapshot = await requestCodexUsage({
				accessToken,
				accountId,
				baseUrl: authResult?.auth.baseUrl ?? provider?.baseUrl,
				signal: controller.signal,
			});
			if (!isCurrentRefresh(refreshGeneration)) return;

			cachedUsage = { accountId, snapshot, stale: false };
			renderUsageStatus(ctx, snapshot, false);
		} catch (error) {
			if (!isCurrentRefresh(refreshGeneration)) return;
			handleRefreshFailure(ctx, error, accountId);
		} finally {
			clearTimeout(timeout);
		}
	}

	function refreshUsage(ctx: ExtensionContext): Promise<void> {
		if (!isCodexContext(ctx) || shutdown) return Promise.resolve();
		const refreshGeneration = generation;
		if (inFlight?.generation === refreshGeneration) return inFlight.promise;

		const controller = new AbortController();
		requestController = controller;
		const promise = performRefresh(ctx, refreshGeneration, controller).finally(() => {
			if (inFlight?.generation === refreshGeneration) inFlight = undefined;
			if (requestController === controller) requestController = undefined;
		});
		inFlight = { generation: refreshGeneration, promise };
		return promise;
	}

	function activate(ctx: ExtensionContext): void {
		generation += 1;
		abortCurrentRefresh();
		activeContext = ctx;
		ensureRefreshInterval();
		if (cachedUsage) {
			renderUsageStatus(ctx, cachedUsage.snapshot, cachedUsage.stale);
		} else {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "Codex quota…"));
		}
		void refreshUsage(ctx);
	}

	pi.on("session_start", (_event, ctx) => {
		shutdown = false;
		if (isCodexContext(ctx)) activate(ctx);
		else deactivate(ctx, true);
	});

	pi.on("model_select", (event, ctx) => {
		if (ctx.mode === "tui" && event.model.provider === CODEX_PROVIDER_ID) {
			activate(ctx);
		} else {
			deactivate(ctx, true);
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (isCodexContext(ctx)) void refreshUsage(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		shutdown = true;
		deactivate(ctx, true);
	});
}
