/**
 * Pi extension — updates the shared /go permission state before each agent run.
 *
 * Command validation consumes the state; this extension owns the prompt lifecycle.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";
import { detectPermissionGrantSource, updatePermissionState } from "../../../.agents/agent-enforcers/permission-enforcer/src/core/state";

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "permission-enforcer");

	pi.on("before_agent_start", async (event) => {
		const prompt = typeof event.prompt === "string" ? event.prompt : "";
		const matchSource = detectPermissionGrantSource(prompt);
		const granted = updatePermissionState(prompt);

		telemetry.append(
			"permission_state_change",
			{
				granted,
				matchSource,
				promptLength: prompt.length,
			},
		);
	});
}
