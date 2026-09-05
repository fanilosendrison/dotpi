# Codex Subscription Usage Footer

## Where / What

The global extension `~/.pi/agent/extensions/codex-usage-footer.ts` adds Codex subscription usage bars to Pi's existing footer status line. It activates only in TUI mode when the selected provider is `openai-codex` or a pi-multi-login alias such as `openai-codex-2`; the API-key provider `openai` is intentionally excluded.

The native footer remains in place. The extension adds a compact third line such as:

`Codex 5h [███████░░░] 68% ↻2h14 · 1sem [███░░░░░░░] 31% ↻3j`

| Display | Meaning |
|---------|---------|
| First bar | Primary rolling subscription window |
| Second bar | Secondary rolling subscription window, when supplied |
| Percentage | Quota already consumed, not quota remaining |
| `↻` value | Approximate time until the window resets |
| `ancien <age>` | Last same-account value retained after a transient failure |

## How It Works

1. Pi resolves the current provider's OAuth credential through `ctx.modelRegistry.getProviderAuth(providerId)` using the **exact provider ID** (including aliases like `openai-codex-2`). The extension never persists or logs credentials.
2. The ChatGPT account ID is decoded from the signed token's `https://api.openai.com/auth` claim.
3. The extension performs an authenticated `GET https://chatgpt.com/backend-api/wham/usage`, the usage endpoint consumed by the official Codex client.
4. The endpoint is strictly allowlisted: HTTPS, `chatgpt.com`, the default port, and `/backend-api` only. Redirects are rejected so credentials cannot be forwarded to another origin.
5. The response is bounded to 64 KiB, validated as unknown input, and converted into primary and secondary usage windows.
6. `ctx.ui.setStatus("codex-usage", ...)` renders the bars without replacing Pi's native footer.

## Multi-Account Support

The extension supports multiple Codex subscriptions through [pi-multi-login](https://github.com/hank-warren/pi-extensions/tree/main/packages/pi-multi-login):

- **Base provider**: `openai-codex` (subscription A)
- **Alias providers**: `openai-codex-2`, `openai-codex-work`, etc. (subscription B, C, ...)

Each provider maintains its own:
- OAuth credential in `auth.json`
- Account ID extracted from the OAuth token
- Quota cache isolated by provider ID

When switching between providers:
- The footer immediately clears the previous provider's cached data
- A new fetch is initiated for the active provider
- Stale data from transient failures is only reused for the **same provider and account**
- If the OAuth account changes for a provider, the cache is invalidated

## Provider Detection

The extension recognizes Codex providers using the following logic:
- Exact match: `openai-codex`
- Alias pattern: any provider ID starting with `openai-codex-` (e.g., `openai-codex-2`, `openai-codex-work`)

This pattern matches the pi-multi-login alias convention of `${base}-${suffix}`.

## Cache Isolation

Quota data is cached per provider ID in a `Map<string, CachedUsage>` where:
- **Key**: exact provider ID (e.g., `"openai-codex"`, `"openai-codex-2"`)
- **Value**: `{ accountId, snapshot, stale }`

This ensures:
- No cross-contamination between different Codex subscriptions
- Account replacement (re-authentication with a different account) invalidates stale cache
- Race conditions are prevented by generation tracking and AbortController

| Refresh trigger | Behavior |
|-----------------|----------|
| Session start | Fetch immediately when a Codex provider is active |
| Model selection | Abort stale work, clear on another provider, fetch on Codex |
| Agent settled | Refresh after retries, compaction, and queued follow-ups finish |
| Active timer | Refresh every five minutes |
| Session shutdown | Abort the request, clear the timer, and remove the status |

Concurrent refreshes are deduplicated **per provider** and each request has a ten-second timeout. Transient network, 408, 429, and 5xx failures retain only data proven to belong to the same account and mark it `ancien`. Authentication, schema, account-change, and permanent endpoint failures clear cached quota data for that provider.

After editing the extension, reload it in the active Pi session:

`/reload`

If the footer says `Codex connexion requise`, authenticate the provider through Pi's `/login` flow.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/codex-usage-footer.ts` | Pi lifecycle, refresh orchestration, and footer status | ✅ |
| `~/.pi/agent/extensions/codex-usage-footer-internals/protocol.ts` | OAuth claim extraction, endpoint guard, request, and schema validation | ✅ |
| `~/.pi/agent/extensions/codex-usage-footer-internals/display.ts` | Progress bars, window labels, reset countdowns, and stale formatting | ✅ |
| `~/.pi/agent/extensions/__tests__/node-parity/codex-usage-footer-protocol.node.ts` | Protocol, endpoint security, parser, and formatter tests | ✅ |
| `~/.pi/agent/extensions/__tests__/node-parity/codex-usage-footer.node.ts` | Lifecycle, deduplication, race, account, and stale-state tests | ✅ |
| `~/.pi/agent/extensions/__tests__/node-smoke/tsconfig.json` | Includes the extension tests in gateway type checking | ✅ |
| `~/.pi/agent/package.json` | Runs both Codex footer test files in the closed Node suite | ✅ |
| `~/.pi/agent/auth.json` | OAuth credential managed by Pi; never read or written directly by the extension | ❌ |

## Background

Pi already identifies subscription-backed sessions with `(sub)`, but it does not show progress against ChatGPT Codex rolling limits. This extension surfaces the server-reported percentages and reset windows while preserving the existing footer and Pi's OAuth lifecycle.

With the addition of pi-multi-login support, multiple Codex subscriptions can now be used simultaneously, each with their own quota tracking.
