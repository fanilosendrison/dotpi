import type {
	CodexUsageSnapshot,
	CodexUsageWindow,
} from "./protocol.ts";

const PROGRESS_BAR_WIDTH = 10;

function formatWindowDuration(windowSeconds: number): string {
	if (windowSeconds % 604_800 === 0) return `${windowSeconds / 604_800}sem`;
	if (windowSeconds % 86_400 === 0) return `${windowSeconds / 86_400}j`;
	if (windowSeconds % 3_600 === 0) return `${windowSeconds / 3_600}h`;
	return `${Math.max(1, Math.round(windowSeconds / 60))}m`;
}

function formatRemainingDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.round(totalSeconds));
	if (seconds < 60) return "maint.";
	if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
	if (seconds < 172_800) {
		const hours = Math.floor(seconds / 3_600);
		const minutes = Math.ceil((seconds % 3_600) / 60);
		return minutes > 0 && minutes < 60 ? `${hours}h${minutes}` : `${hours + 1}h`;
	}
	return `${Math.ceil(seconds / 86_400)}j`;
}

export function formatProgressBar(usedPercent: number): string {
	const clamped = Math.max(0, Math.min(100, usedPercent));
	const usedCells = Math.round((clamped / 100) * PROGRESS_BAR_WIDTH);
	return `[${"█".repeat(usedCells)}${"░".repeat(PROGRESS_BAR_WIDTH - usedCells)}]`;
}

function formatWindow(window: CodexUsageWindow, now: number): string {
	const duration = formatWindowDuration(window.windowSeconds);
	const percentage = Number.isInteger(window.usedPercent)
		? window.usedPercent.toFixed(0)
		: window.usedPercent.toFixed(1);
	const resetInSeconds = window.resetsAt - now / 1_000;
	return `${duration} ${formatProgressBar(window.usedPercent)} ${percentage}% ↻${formatRemainingDuration(resetInSeconds)}`;
}

function formatStaleAge(capturedAt: number, now: number): string {
	const ageMinutes = Math.max(1, Math.floor((now - capturedAt) / 60_000));
	if (ageMinutes < 60) return `${ageMinutes}m`;
	const hours = Math.floor(ageMinutes / 60);
	const minutes = ageMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h${minutes}`;
}

export function formatCodexUsageStatus(
	snapshot: CodexUsageSnapshot,
	options: { now?: number; stale?: boolean } = {},
): string {
	const now = options.now ?? Date.now();
	const windows = [snapshot.primary, snapshot.secondary].filter(
		(window): window is CodexUsageWindow => window !== undefined,
	);
	if (windows.length === 0) return "Codex quota indisponible";

	const status = `Codex ${windows.map((window) => formatWindow(window, now)).join(" · ")}`;
	return options.stale
		? `${status} · ancien ${formatStaleAge(snapshot.capturedAt, now)}`
		: status;
}

export function highestCodexUsagePercent(snapshot: CodexUsageSnapshot): number {
	return Math.max(
		snapshot.primary?.usedPercent ?? 0,
		snapshot.secondary?.usedPercent ?? 0,
	);
}
