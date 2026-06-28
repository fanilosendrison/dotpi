/**
 * Pi extension — validates git commit messages against Conventional Commits 1.0.0.
 *
 * Blocks commits with invalid format, wrong types, past tense, or vague messages.
 * The validation logic mirrors `~/.agents/agent-hooks/commit-msg-validator/src/core/validator.ts`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const VALID_TYPES = [
  "feat", "fix", "docs", "style", "refactor", "perf",
  "test", "build", "ci", "chore", "revert",
] as const;

const COMMIT_MSG_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s(.+)$/;

const PAST_TENSE = /^(added|fixed|removed|updated|changed|deleted|created|modified|moved|renamed|resolved|refactored|implemented|improved)\b/i;
const GERUND = /^(adding|fixing|removing|updating|changing|deleting|creating|modifying|moving|renaming|resolving|refactoring|implementing|improving)\b/i;

const VAGUE = new Set([
  "fix bug", "fix bugs", "bug fix", "bugfix", "updates", "update",
  "stuff", "things", "changes", "change", "wip", "temp", "misc", "minor",
]);

function extractMessage(command: string): string | null {
  // Heredoc: git commit -m "$(cat <<'EOF'\n...\nEOF\n)"
  const heredoc = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/);
  if (heredoc) {
    const lines = heredoc[1].split("\n").map((l) => l.trim()).filter((l) => l);
    return lines[0] || null;
  }
  // Double quotes: git commit -m "..."
  const dq = command.match(/-m\s+"([\s\S]*?)"/);
  if (dq) return dq[1].split("\n")[0].trim() || null;
  // Single quotes: git commit -m '...'
  const sq = command.match(/-m\s+'([\s\S]*?)'/);
  if (sq) return sq[1].split("\n")[0].trim() || null;

  return null;
}

function validate(message: string): string[] {
  const errors: string[] = [];
  const trimmed = message.trim();

  const match = trimmed.match(COMMIT_MSG_REGEX);
  if (!match) {
    return ["Format invalide. Attendu: <type>(<scope>): <description>"];
  }

  const [, type, , , description] = match;

  if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    errors.push(`Type "${type}" invalide. Types autorisés: ${VALID_TYPES.join(", ")}`);
  }

  if (/^[A-Z]/.test(description)) {
    errors.push("La description ne doit pas commencer par une majuscule après le deux-points");
  }

  if (description.endsWith(".")) {
    errors.push("La description ne doit pas se terminer par un point");
  }

  if (trimmed.length > 72) {
    errors.push(`Subject line trop long: ${trimmed.length}/72 caractères max`);
  }

  if (PAST_TENSE.test(description)) {
    errors.push("Utiliser l'impératif présent (add, fix, remove) — pas le passé (added, fixed, removed)");
  }

  if (GERUND.test(description)) {
    errors.push("Utiliser l'impératif présent (add, fix, remove) — pas le gérondif (adding, fixing, removing)");
  }

  if (VAGUE.has(description.toLowerCase())) {
    errors.push(`Description trop vague: "${description}". Être spécifique sur ce qui a changé`);
  }

  return errors;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (!isToolCallEventType("bash", event)) return;

    const cmd = event.input.command;
    if (!/\bgit\s+commit\b/.test(cmd)) return;

    const message = extractMessage(cmd);
    if (!message) return; // no -m message found (e.g., interactive editor)

    const errors = validate(message);
    if (errors.length > 0) {
      return { block: true, reason: `Commit message invalide:\n- ${errors.join("\n- ")}` };
    }
  });
}
