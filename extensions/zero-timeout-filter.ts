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
import { createPiTelemetry } from "./shared/pi-telemetry";
import { onBashToolCall } from "./shared/pi-tool-events";
import { isGitCommitsPushSkillCommand } from "../../../.agents/agent-enforcers/git-commits-push-enforcer/src/core/validator";

function isGitCommitsPushShellLaunch(command: string): boolean {
	return (
		isGitCommitsPushSkillCommand(command) && command.includes("bun run start")
	);
}

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "zero-timeout-filter", {
		statsDir: process.env.ZERO_TIMEOUT_FILTER_STATS_DIR,
	});

	// ── Strip timeout on skill invocation ───────────────────────────────────

	onBashToolCall(pi, async (event, cmd) => {
		if (!isGitCommitsPushShellLaunch(cmd)) return;
		const originalTimeout = event.input.timeout;

		// Strip the timeout regardless — skill manages its own
		delete event.input.timeout;

		// Log only if there was actually a timeout to strip
		if (originalTimeout === undefined) return;

		telemetry.append(
			"timeout_stripped",
			{
				originalTimeout,
				toolCallId: event.toolCallId,
			},
		);
	});
}
