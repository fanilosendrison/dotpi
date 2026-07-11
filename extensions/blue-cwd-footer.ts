/**
 * Blue CWD Footer — custom footer that replicates the default Pi footer
 * but renders the CWD path in "accent" instead of "dim".
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Helpers — mirror formatCwdForFooter / formatTokens from the built-in footer
// ---------------------------------------------------------------------------

function formatCwd(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const rCwd = resolve(cwd);
  const rHome = resolve(home);
  const rel = relative(rHome, rCwd);
  const inside =
    rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!inside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

function sanitizeStatus(t: string): string {
  return t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  let thinkingLevel = "off";

  pi.on("thinking_level_select", (event) => {
    thinkingLevel = event.level;
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // ---- token stats (all entries, not just post-compaction) ----
          let inp = 0, out = 0, cacheR = 0, cacheW = 0, cost = 0;
          for (const e of ctx.sessionManager.getEntries()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              inp += m.usage.input;
              out += m.usage.output;
              cacheR += m.usage.cacheRead;
              cacheW += m.usage.cacheWrite;
              cost += m.usage.cost.total;
            }
          }

          // ---- context usage ----
          const cu = ctx.getContextUsage();
          const ctxWin = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const pctVal = cu?.percent ?? null;
          const pctStr = pctVal !== null ? `${pctVal.toFixed(1)}%` : "?";

          // ---- CWD line: path in accent (blue), branch in mdHeading (gold) ----
          const home = process.env.HOME || process.env.USERPROFILE;
          const cwdPath = formatCwd(ctx.sessionManager.getCwd(), home);
          const branch = footerData.getGitBranch();
          const sesh = ctx.sessionManager.getSessionName();

          // Build CWD line with mixed colors
          let cwdLine = theme.fg("accent", cwdPath);
          if (branch) cwdLine += ` ${theme.fg("mdHeading", `(${branch})`)}`;
          if (sesh) cwdLine += theme.fg("accent", ` • ${sesh}`);

          // ---- stats line parts ----
          const parts: string[] = [];
          if (inp) parts.push(`↑${fmtTokens(inp)}`);
          if (out) parts.push(`↓${fmtTokens(out)}`);
          if (cacheR) parts.push(`R${fmtTokens(cacheR)}`);
          if (cacheW) parts.push(`W${fmtTokens(cacheW)}`);
          if (cost) parts.push(`$${cost.toFixed(3)}`);

          // context % (colored by usage) + auto indicator
          const autoLabel = " (auto)";
          const ctxFull = `${pctStr}/${fmtTokens(ctxWin)}${autoLabel}`;
          let ctxColored: string;
          if (pctVal !== null && pctVal > 90) ctxColored = theme.fg("error", ctxFull);
          else if (pctVal !== null && pctVal > 70) ctxColored = theme.fg("warning", ctxFull);
          else ctxColored = ctxFull;
          parts.push(ctxColored);

          let statsLeft = parts.join(" ");

          // ---- model name + thinking level (right-aligned) ----
          const model = ctx.model;
          let right = model?.id || "no-model";
          if (model?.reasoning) {
            right =
              thinkingLevel === "off"
                ? `${right} • thinking off`
                : `${right} • ${thinkingLevel}`;
          }

          const leftW = visibleWidth(statsLeft);
          const rightW = visibleWidth(right);

          let statsLine: string;
          if (leftW + 2 + rightW <= width) {
            const pad = " ".repeat(width - leftW - rightW);
            statsLine = statsLeft + pad + right;
          } else if (leftW + 2 < width) {
            const avail = width - leftW - 2;
            const trunc = truncateToWidth(right, avail, "");
            const pad = " ".repeat(Math.max(0, width - leftW - visibleWidth(trunc)));
            statsLine = statsLeft + pad + trunc;
          } else {
            statsLine = truncateToWidth(statsLeft, width, "...");
          }

          // Separate dim wrappers so inner color codes don't reset outer dim
          const dimLeft = theme.fg("dim", statsLeft);
          const remainder = statsLine.slice(statsLeft.length);
          const dimRight = theme.fg("dim", remainder);

          // CWD line
          const pwdLine = truncateToWidth(
            cwdLine,
            width,
            theme.fg("accent", "..."),
          );

          const lines = [pwdLine, dimLeft + dimRight];

          // ---- extension statuses ----
          const statuses = footerData.getExtensionStatuses();
          if (statuses.size > 0) {
            const statusStr = [...statuses.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, t]) => sanitizeStatus(t))
              .join(" ");
            lines.push(truncateToWidth(statusStr, width, theme.fg("dim", "...")));
          }

          return lines;
        },
      };
    });
  });
}
