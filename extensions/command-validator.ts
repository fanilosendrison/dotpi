/**
 * Pi extension — validates bash commands against security rules.
 *
 * Imports the shared validator from ~/.agents/agent-enforcers/command-validator/.
 * No duplicated logic — all harnesses share the same rules.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const VALIDATOR_PATH = join(
	homedir(),
	".agents/agent-enforcers/command-validator/src/core/validator",
);
const { CommandValidator } = require(VALIDATOR_PATH);

export default function (pi: ExtensionAPI) {
	const validator = new CommandValidator();

	// ── Validate bash commands ───────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		const result = validator.validate(cmd, "bash");

		if (result.action === "deny") {
			return { block: true, reason: result.violations.join("; ") };
		}

		if (result.action === "ask") {
			const ok = await ctx.ui.confirm(
				"Dangerous command",
				`Allow: ${cmd.slice(0, 100)}`,
			);
			if (!ok) {
				return { block: true, reason: "Blocked by user" };
			}
		}
	});
}
