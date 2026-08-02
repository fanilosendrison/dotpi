---
okf_version: "1.0"
kind: "KnowledgeAsset"
asset_type: "documentation"
domain: "pi-harness"
severity: "strict"
name: "Pi Subagents Cross-Harness Agent Frontmatter"
version: "0.1.0"
---

# Pi Subagents Cross-Harness Agent Frontmatter

## Where / What

This patch preserves the local compatibility overlay for `pi-subagents@0.35.1`. It does not modify the Pi core package.

| Target | Location | Purpose |
| ------ | -------- | ------- |
| Extension source | `~/.pi/agent/extensions/pi-subagents-4-turnlock/src/agents/agents.ts` | Loads shared agent frontmatter. |
| Patch package | `~/.pi/agent/patches/pi-subagents-cross-harness-agent-frontmatter/` | Reapplies, reverts, and verifies the overlay. |

The overlay reads a nested `pi:` block from a shared agent definition. Its nonempty fields replace top-level Claude Code fields for Pi. A Pi value of `false` or an empty string removes the top-level field; `model: false` therefore lets Pi select its configured default model instead of the Claude model.

## How It Works

Apply the patch after replacing or refreshing the `pi-subagents` extension:

```bash
~/.pi/agent/patches/pi-subagents-cross-harness-agent-frontmatter/apply.sh
```

Revert it when comparing behavior with the upstream extension:

```bash
~/.pi/agent/patches/pi-subagents-cross-harness-agent-frontmatter/revert.sh
```

Set `PI_SUBAGENTS_EXTENSION_DIR` to target a non-default extension directory:

```bash
PI_SUBAGENTS_EXTENSION_DIR="<extension-dir>" \
  ~/.pi/agent/patches/pi-subagents-cross-harness-agent-frontmatter/apply.sh
```

| Placeholder | Meaning |
| ----------- | ------- |
| `<extension-dir>` | Root directory containing the `pi-subagents` `package.json` file. |

The scripts accept only `pi-subagents@0.35.1`, use forward and reverse dry-runs to prevent unintended changes, and run an isolated Node test after application. A failed verification rolls back a patch applied during that invocation.

## Relevant Files

| File | Purpose | Versioned |
| ---- | ------- | --------- |
| `patches/pi-subagents-cross-harness-agent-frontmatter/cross-harness-agent-frontmatter.patch` | Source delta against upstream 0.35.1. | ✅ |
| `patches/pi-subagents-cross-harness-agent-frontmatter/apply.sh` | Safe, idempotent patch application. | ✅ |
| `patches/pi-subagents-cross-harness-agent-frontmatter/revert.sh` | Safe patch reversion. | ✅ |
| `patches/pi-subagents-cross-harness-agent-frontmatter/verify-cross-harness-agent.test.mjs` | Isolated behavioral verifier. | ✅ |
| `extensions/pi-subagents-4-turnlock/src/agents/agents.ts` | Patched extension source. | ✅ |
| `extensions/pi-subagents-4-turnlock/test/unit/cross-harness-agent.test.ts` | Local Node regression test. | ✅ |

## Background

Shared agents keep Claude Code metadata at the top level and store Pi-specific values in a nested `pi:` block. Upstream `pi-subagents@0.35.1` parses the nested block as text but does not merge it into runtime agent configuration. The patch makes that merge explicit and reproducible across extension refreshes.
