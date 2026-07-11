import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PiPermissionScope {
	agent: "pi";
	sessionId: string;
}

export function getPiPermissionScope(
	ctx: Pick<ExtensionContext, "sessionManager">,
): PiPermissionScope {
	return {
		agent: "pi",
		sessionId: ctx.sessionManager.getSessionId(),
	};
}
