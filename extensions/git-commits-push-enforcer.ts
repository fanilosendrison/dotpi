/**
 * Pi extension — intercepts every commit intent (raw git or /git-commits-push)
 * and blocks direct raw git mutations.
 *
 * Logs one event per trigger with all context.
 *
 * Stats in ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "./shared/pi-telemetry";

const SKILL_CMD = /\/git-commits-push(?:\s|$)/;
const SKILL_LAUNCH_PATH = /\.agents\/skills\/git-commits-push(?:\s|\/|$)/;
const RAW_GIT_MUTATIONS = new Set(["commit", "commit-tree", "push"]);
const GIT_OPTIONS_WITH_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--config-env",
	"--super-prefix",
]);
const GIT_OPTIONS_WITH_EQUALS_VALUE = [
	"--git-dir=",
	"--work-tree=",
	"--namespace=",
	"--exec-path=",
	"--config-env=",
	"--super-prefix=",
];
const SHELL_COMMANDS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);

export type CommitIntentDetection = "git-commit" | "git-commits-push";
export type RawGitMutation = "commit" | "commit-tree" | "push";

/** True when the command is a skill invocation (/git-commits-push or launch command). */
export function isSkillCmd(cmd: string): boolean {
	return SKILL_CMD.test(cmd) || SKILL_LAUNCH_PATH.test(cmd);
}

/** True when the command represents a commit intent (raw git or skill). */
export function isCommitIntent(cmd: string): boolean {
	return detectRawGitMutation(cmd) !== null || isSkillCmd(cmd);
}

function splitShellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	const pushCurrent = () => {
		const trimmed = current.trim();
		if (trimmed.length > 0) segments.push(trimmed);
		current = "";
	};

	for (let i = 0; i < command.length; i++) {
		const char = command[i];

		if (quote !== "'" && char === "\\") {
			current += char;
			if (command[i + 1] !== undefined) {
				current += command[i + 1];
				i++;
			}
			continue;
		}

		if (quote) {
			current += char;
			if (char === quote) quote = null;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		if (char === "\n" || char === ";") {
			pushCurrent();
			continue;
		}

		if (
			(char === "&" && command[i + 1] === "&") ||
			(char === "|" && command[i + 1] === "|")
		) {
			pushCurrent();
			i++;
			continue;
		}

		if (char === "|") {
			pushCurrent();
			continue;
		}

		current += char;
	}

	pushCurrent();
	return segments;
}

function tokenizeShellSegment(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	const pushCurrent = () => {
		if (current.length > 0) {
			tokens.push(current);
			current = "";
		}
	};

	for (let i = 0; i < segment.length; i++) {
		const char = segment[i];

		if (quote !== "'" && char === "\\") {
			const next = segment[i + 1];
			if (next !== undefined) {
				current += next;
				i++;
			}
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			pushCurrent();
			continue;
		}

		current += char;
	}

	pushCurrent();
	return tokens;
}

function commandName(token: string): string {
	return token.split("/").pop() || token;
}

function isAssignmentToken(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function skipSudoOptions(tokens: string[], index: number): number {
	let i = index;
	while (i < tokens.length && tokens[i]?.startsWith("-")) {
		const option = tokens[i];
		i++;
		if (option === "-u" || option === "-g" || option === "-h") {
			i++;
		}
	}
	return i;
}

interface EnvPrefixResult {
	index: number;
	nestedMutation?: RawGitMutation;
}

function skipEnvPrefix(tokens: string[], index: number): EnvPrefixResult {
	let i = index;
	while (i < tokens.length) {
		const token = tokens[i];
		if (!token) break;
		if (isAssignmentToken(token)) {
			i++;
			continue;
		}
		if (token === "-u" || token === "--unset") {
			i += 2;
			continue;
		}
		if (token === "-C" || token === "--chdir") {
			i += 2;
			continue;
		}
		if (token === "-S" && tokens[i + 1]) {
			const nestedMutation = detectRawGitMutation(tokens[i + 1]);
			return nestedMutation
				? { index: tokens.length, nestedMutation }
				: { index: i + 2 };
		}
		if (token === "-i" || token === "--ignore-environment" || token === "-0") {
			i++;
			continue;
		}
		if (token.startsWith("-")) {
			i++;
			continue;
		}
		break;
	}
	return { index: i };
}

function mutationFromGitArguments(
	tokens: string[],
	gitIndex: number,
): RawGitMutation | null {
	for (let i = gitIndex + 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token) continue;

		if (GIT_OPTIONS_WITH_VALUE.has(token)) {
			i++;
			continue;
		}

		if (
			GIT_OPTIONS_WITH_EQUALS_VALUE.some((option) => token.startsWith(option))
		) {
			continue;
		}

		if (token.startsWith("-")) {
			continue;
		}

		return RAW_GIT_MUTATIONS.has(token) ? (token as RawGitMutation) : null;
	}

	return null;
}

function detectRawGitMutationInTokens(tokens: string[]): RawGitMutation | null {
	let index = 0;
	while (index < tokens.length && isAssignmentToken(tokens[index] || "")) {
		index++;
	}

	for (;;) {
		const name = commandName(tokens[index] || "");
		if (name === "env") {
			const envResult = skipEnvPrefix(tokens, index + 1);
			if (envResult.nestedMutation) return envResult.nestedMutation;
			index = envResult.index;
			continue;
		}
		if (name === "sudo") {
			index = skipSudoOptions(tokens, index + 1);
			continue;
		}
		if (name === "command" || name === "exec" || name === "nohup") {
			index++;
			continue;
		}
		break;
	}

	const name = commandName(tokens[index] || "");
	if (
		SHELL_COMMANDS.has(name) &&
		tokens[index + 1] === "-c" &&
		tokens[index + 2]
	) {
		return detectRawGitMutation(tokens[index + 2]);
	}

	if (name !== "git") {
		return null;
	}

	return mutationFromGitArguments(tokens, index);
}

export function detectRawGitMutation(command: string): RawGitMutation | null {
	for (const segment of splitShellSegments(command)) {
		const mutation = detectRawGitMutationInTokens(
			tokenizeShellSegment(segment),
		);
		if (mutation) return mutation;
	}
	return null;
}

export function detectCommitIntent(
	command: string,
): CommitIntentDetection | null {
	if (isSkillCmd(command)) return "git-commits-push";
	if (detectRawGitMutation(command)) return "git-commit";
	return null;
}

function truncateForReason(command: string): string {
	return command.length <= 80 ? command : `${command.slice(0, 80)}...`;
}

function buildDirectGitDeniedReason(command: string): string {
	return [
		"Direct git commits are blocked. Use /git-commits-push instead.",
		"",
		`Got: "${truncateForReason(command)}"`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	const telemetry = createPiTelemetry(pi, "git-commits-push-enforcer");

	// ── Intercept commit intent ─────────────────────────────────────────────
	//
	// Skill invocations are logged and allowed. Direct raw git mutations are
	// blocked so commits flow through the git-commits-push skill.

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd = event.input.command;
		if (!cmd || typeof cmd !== "string") return;

		const detectedBy = detectCommitIntent(cmd);
		if (!detectedBy) return;
		const mutation = detectRawGitMutation(cmd);

		const details = {
			rawCommand: cmd,
			detectedBy,
			toolCallId: event.toolCallId,
			parentModel: telemetry.model,
			thinkingLevel: telemetry.thinking,
		};

		if (detectedBy === "git-commits-push") {
			// Pass parent model/session to the skill via env vars.
			process.env.PI_PARENT_MODEL = telemetry.model;
			process.env.PI_SESSION_ID = telemetry.sessionId;

			telemetry.sink.append("enforcer_triggered", details, {
				timestamp: new Date().toISOString(),
			});
			return;
		}

		if (process.env.BYPASS_GIT_ENFORCER === "1") {
			telemetry.sink.append(
				"skipped",
				{
					...details,
					reason: "bypass-enforcer",
					...(mutation ? { mutation } : {}),
				},
				{ timestamp: new Date().toISOString() },
			);
			return;
		}

		telemetry.sink.append(
			"blocked",
			{
				...details,
				...(mutation ? { mutation } : {}),
			},
			{ timestamp: new Date().toISOString() },
		);

		return {
			block: true,
			reason: buildDirectGitDeniedReason(cmd),
		};
	});
}
