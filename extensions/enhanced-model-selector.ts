/**
 * Enhanced Model Selector — shows cost, context window, max output tokens,
 * supported thinking levels, and auth status for every model — all on one line.
 *
 * Accessible via:
 *   - /switch-model  (extension command)
 *   - /model         (intercepted via input event)
 *   - Ctrl+Shift+L    (custom shortcut)
 */

import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtCost(c: Model<any>["cost"]): string {
  const in_ = c.input === 0 ? "?" : `$${c.input.toFixed(2)}`;
  const out = c.output === 0 ? "?" : `$${c.output.toFixed(2)}`;
  return `${in_}/${out}`;
}

function fmtLevels(levels: readonly ModelThinkingLevel[]): string {
  if (levels.length === 1 && levels[0] === "off") return "—";
  const short: Record<string, string> = {
    off: "off", minimal: "min", low: "low",
    medium: "med", high: "high", xhigh: "xhi",
  };
  return levels.map((l) => short[l] ?? l).join(",");
}

function padR(s: string, min: number): string {
  if (s.length >= min) return s;
  return s + " ".repeat(min - s.length);
}

// ── shared selector logic ────────────────────────────────────────────────────

async function showSelector(pi: ExtensionAPI, ctx: ExtensionContext) {
  const allModels = ctx.modelRegistry.getAll();

  if (allModels.length === 0) {
    ctx.ui.notify("No models available.", "warning");
    return;
  }

  // Sort globally by input cost (cheapest first).
  // Zero-cost models (= unknown) go to the bottom.
  const sorted = [...allModels].sort((a, b) => {
    const aCost = a.cost.input === 0 ? Infinity : a.cost.input;
    const bCost = b.cost.input === 0 ? Infinity : b.cost.input;
    if (aCost !== bCost) return aCost - bCost;
    return a.id.localeCompare(b.id);
  });

  // Compute max model-id width for column alignment
  const maxIdLen = Math.max(...sorted.map((m) => m.id.length), 4);

  // Build SelectItems — all info on one line
  const currentModel = ctx.model;
  const currentKey = currentModel
    ? `${currentModel.provider}/${currentModel.id}`
    : undefined;

  const items: SelectItem[] = sorted.map((m) => {
    const providerLabel = ctx.modelRegistry.getProviderDisplayName(m.provider);
    const hasAuth = ctx.modelRegistry.hasConfiguredAuth(m);
    const levels = getSupportedThinkingLevels(m);
    const thinking = fmtLevels(levels);
    const cost = fmtCost(m.cost);
    const ctxWin = fmtNum(m.contextWindow);
    const maxOut = fmtNum(m.maxTokens);
    const isCurrent = `${m.provider}/${m.id}` === currentKey;

    const marker = isCurrent ? "★" : " ";
    const idPadded = padR(m.id, maxIdLen);
    const costPadded = padR(cost, 14);
    const ctxPadded = padR(ctxWin, 6);
    const outPadded = padR(maxOut, 6);
    const thinkingPadded = padR(thinking, 26);
    const authEmoji = hasAuth ? "🔑" : "🔒";
    const providerPadded = padR(providerLabel, 16);

    const label =
      `${marker} ${idPadded}  💰 ${costPadded}  📐 ${ctxPadded}  📤 ${outPadded}  🧠 ${thinkingPadded}  ${authEmoji}  ${providerPadded}`;

    // Put searchable text in `value` so the filter can match against
    // cost, context, thinking, provider, etc.
    const value = `${m.provider}/${m.id}` +
      ` | 💰 ${cost} | 📐 ${ctxWin} | 📤 ${maxOut} | 🧠 ${thinking} | ${hasAuth ? "key" : "nokey"} | ${providerLabel}`;

    return { value, label };
  });

  // Show the selector
  const result = await ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      const container = new Container();

      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      container.addChild(
        new Text(
          theme.fg("accent", theme.bold("Switch Model")),
          1,
          0,
        ),
      );

      // Column legend
      const legendId = padR("model", maxIdLen);
      const legendCost = padR("cost/1M", 14);
      const legendCtx = padR("ctx", 6);
      const legendOut = padR("out", 6);
      const legendThink = padR("thinking", 26);
      const legendProv = padR("provider", 16);
      container.addChild(
        new Text(
          theme.fg("dim",
            `  ${legendId}  💰 ${legendCost}  📐 ${legendCtx}  📤 ${legendOut}  🧠 ${legendThink}  🔑  ${legendProv}`),
          1,
          0,
        ),
      );

      // Use a slot container so we can swap the SelectList in-place when
      // the filter changes, keeping it between header and footer.
      const listSlot = new Container();
      container.addChild(listSlot);

      container.addChild(
        new Text(
          theme.fg("dim",
            "↑↓ navigate · type to filter · enter select · esc cancel"),
          1,
          0,
        ),
      );

      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      // Rebuild the SelectList when the filter changes so we can match
      // against the full value (cost, thinking, provider, etc.), not just
      // the model id prefix that built-in setFilter() checks.
      let filter = "";
      let selectList: SelectList;

      const buildSelectList = (filterText: string) => {
        const filtered = filterText === ""
          ? items
          : items.filter((it) =>
              it.value.toLowerCase().includes(filterText.toLowerCase()));

        const newList = new SelectList(
          filtered,
          Math.min(filtered.length || 1, 20),
          {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        );

        newList.onSelect = (item) => {
          done(item.value.split(" | ")[0]);
        };
        newList.onCancel = () => done(null);

        listSlot.clear();
        listSlot.addChild(newList);
        selectList = newList;
      };

      buildSelectList("");

      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => {
          // Printable ASCII: accumulate filter
          if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) !== 127) {
            filter += data;
            buildSelectList(filter);
            tui.requestRender();
            return;
          }
          // Backspace: remove last filter character
          if (data === "\x7f" || data === "\b" || data === "backspace") {
            filter = filter.slice(0, -1);
            buildSelectList(filter);
            tui.requestRender();
            return;
          }
          // Delegate other keys (arrows, enter, escape, etc.) to SelectList
          if (selectList) selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
  );

  if (!result) return;

  const slashIdx = result.indexOf("/");
  if (slashIdx === -1) return;
  const provider = result.slice(0, slashIdx);
  const modelId = result.slice(slashIdx + 1);

  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    ctx.ui.notify(`Model not found: ${result}`, "error");
    return;
  }

  const ok = await pi.setModel(model);
  if (ok) {
    ctx.ui.notify(`Model set to ${model.id}`, "info");
  } else {
    ctx.ui.notify(
      `No API key for ${provider}/${model.id}`,
      "warning",
    );
  }
}

// ── extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // 1. Register under a non-conflicting name
  pi.registerCommand("switch-model", {
    description: "Switch models with cost, context, thinking levels",
    handler: async (_args, ctx) => {
      await showSelector(pi, ctx);
    },
  });

  // 2. Intercept /model typed by the user → redirect to our selector
  pi.on("input", async (event, ctx) => {
    const trimmed = event.text.trim();
    if (trimmed === "/model" || trimmed === "/m") {
      await showSelector(pi, ctx);
      return { action: "handled" };
    }
    return { action: "continue" };
  });

  // 3. Ctrl+Shift+L shortcut (Ctrl+L is a protected built-in)
  pi.registerShortcut(Key.ctrlShift("l"), {
    description: "Enhanced model selector",
    handler: async (ctx) => {
      await showSelector(pi, ctx);
    },
  });
}
