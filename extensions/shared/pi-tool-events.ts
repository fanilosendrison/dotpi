import type {
	BashToolCallEvent,
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

type MaybePromise<T> = T | Promise<T>;

export type BashToolCallHandler = (
	event: BashToolCallEvent,
	command: string,
	ctx: ExtensionContext,
) => MaybePromise<ToolCallEventResult | void>;

export function isBashToolCall(event: ToolCallEvent): event is BashToolCallEvent {
	return isToolCallEventType("bash", event);
}

export function getBashCommand(event: ToolCallEvent): string | null {
	if (!isBashToolCall(event)) return null;

	const { command } = event.input;
	if (typeof command !== "string" || command.length === 0) return null;

	return command;
}

export function onBashToolCall(
	pi: ExtensionAPI,
	handler: BashToolCallHandler,
): void {
	pi.on("tool_call", async (event, ctx) => {
		const command = getBashCommand(event);
		if (command === null) return;

		return handler(event, command, ctx);
	});
}
