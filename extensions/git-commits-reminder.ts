/**
 * Pi extension — blocks direct git commit unless message follows Conventional Commits
 * AND the commit is followed by a push.
 *
 * Forces the agent to use /git-commits-push.
 * Mirrors ~/.agents/agent-hooks/git-commits-push-enforcer/
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const GIT_COMMIT = /git\s+commit\b/;
const CC_REGEX = /^[a-z]+(\([^)]+\))?!?:\s\S/;

function extractMessage(command: string): string | null {
  const heredoc = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/);
  if (heredoc) {
    const lines = heredoc[1].split("\n").map((l) => l.trim()).filter((l) => l);
    return lines[0] || null;
  }
  const dq = command.match(/-m\s+"([\s\S]*?)"/);
  if (dq) return dq[1].split("\n")[0].trim() || null;
  const sq = command.match(/-m\s+'([\s\S]*?)'/);
  if (sq) return sq[1].split("\n")[0].trim() || null;
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!GIT_COMMIT.test(event.input.command)) return;

    // Allow git commit without -m (interactive editor)
    const msg = extractMessage(event.input.command);
    if (msg === null) return;

    // Block if the inline message doesn't look like Conventional Commits
    if (!CC_REGEX.test(msg)) {
      return {
        block: true,
        reason:
          "Use /git-commits-push to generate a Conventional Commits message.\n" +
          `Got: "${msg.slice(0, 60)}" — expected: <type>(<scope>): <description>`,
      };
    }

    // Block if commit is not followed by push
    if (!/git\s+push\b/.test(event.input.command)) {
      return {
        block: true,
        reason:
          "Always push after commit. Use: git commit ... && git push\n" +
          "Or invoke /git-commits-push which handles this automatically.",
      };
    }
  });
}
