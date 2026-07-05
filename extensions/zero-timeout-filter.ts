/**
 * Pi extension — strips external timeout from git-commits-push skill invocations.
 *
 * The skill manages its own deadlines (600s/delegation). If the agent
 * sets a short shell timeout, it orphans the run. This extension
 * silently removes the timeout before the command executes.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;
		if (!cmd.includes("bun run start")) return;
		if (!cmd.includes("git-commits-push")) return;
		delete event.input.timeout;
	});
}
