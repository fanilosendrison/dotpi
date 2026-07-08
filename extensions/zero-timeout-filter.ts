/**
 * Pi extension — strips external timeout from git-commits-push skill invocations.
 *
 * The skill manages its own deadlines (600s/delegation). If the agent
 * sets a short shell timeout, it orphans the run. This extension
 * silently removes the timeout before the command executes.
 *
 * Stats: logs every stripped timeout to
 * ~/neelopedia/stats/pi/zero-timeout-filter/events.jsonl
 * for computing the ratio: stripped / git-commits-push invocations.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "zero-timeout-filter", {
		statsDir: process.env.ZERO_TIMEOUT_FILTER_STATS_DIR,
	});

	// ── Strip timeout on skill invocation ───────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!cmd.includes("bun run start")) return;
		if (!cmd.includes(".agents/skills/git-commits-push")) return;

		const originalTimeout = event.input.timeout;

		// Strip the timeout regardless — skill manages its own
		delete event.input.timeout;

		// Log only if there was actually a timeout to strip
		if (originalTimeout === undefined) return;

		telemetry.sink.append(
			"timeout_stripped",
			{
				originalTimeout,
				parentModel: telemetry.model,
				thinkingLevel: telemetry.thinking,
				toolCallId: event.toolCallId,
			},
			{
				timestamp: new Date().toISOString(),
			},
		);
	});
}

