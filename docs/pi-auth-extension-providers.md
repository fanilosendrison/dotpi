---
okf_version: "1.0"
kind: "KnowledgeAsset"
asset_type: "documentation"
domain: "pi-harness"
severity: "strict"
name: "Pi Auth Extension Providers"
version: "0.1.0"
---

# Pi Auth Extension Providers

## Where / What

This package-level patch makes Pi `0.84.2` auth commands resolve providers registered by global extensions. It fixes commands such as:

```bash
pi auth check --provider openai-codex-2 --json --no-refresh
pi auth print-bearer-token --provider openai-codex-2 --min-expiry 0ms
```

`openai-codex-2` is registered by `pi-multi-login`; it is not a built-in Pi provider. Ordinary Pi sessions already loaded that extension and recognized the alias, but the early `pi auth` path previously created an isolated built-in-only `ModelRuntime`.

| Target | Location | Purpose |
| ------ | -------- | ------- |
| Installed Pi entry point | Resolved from the active `pi` executable to `dist/main.js` | Loads extension provider registrations for valid auth commands. |
| Session-services implementation | Installed Pi `dist/core/agent-session-services.js` | Lets this specialized caller skip the global provider-availability pass. |
| Session-services declaration | Installed Pi `dist/core/agent-session-services.d.ts` | Declares the opt-out while preserving the default behavior. |
| Persistent patch package | `~/.pi/agent/patches/pi-auth-extension-providers/` | Applies, reverts, and verifies the exact Pi `0.84.2` change. |

The patch does not canonicalize aliases and does not modify `pi-multi-login`. Each requested provider ID remains authoritative, so credentials continue to resolve from that provider's distinct `auth.json` slot.

## How It Works

After an auth subcommand and its arguments are validated, Pi creates the command's original `ModelRuntime`:

- `auth check --no-refresh` retains `ReadOnlyAuthStorage`;
- refresh-enabled checks retain writable `AuthStorage`;
- credential-printing commands retain their normal OAuth refresh behavior.

Pi then passes that runtime to `createAgentSessionServices()`. The service loader reads global settings and extensions with project trust disabled and flushes extension provider registrations into the auth runtime. The patch adds `refreshModelAvailability`, an optional service input that defaults to `true`; the auth bootstrap alone sets it to `false`. This prevents service composition from checking every provider or resolving unrelated command-backed credentials. It does not create an `AgentSession` or emit `session_start`.

Pi `0.84.2` has no provider-only extension loader. The patch therefore loads all enabled global extensions while explicitly excluding unrelated resources:

- skills;
- prompt templates;
- themes;
- context files;
- base and appended system prompts.

During bootstrap, `takeOverStdout()` redirects incidental extension stdout to stderr. Only the auth result uses guarded raw stdout, and Pi waits for raw-output backpressure. Because auth is a one-shot CLI path, stdout remains guarded until process exit so delayed extension output cannot corrupt machine output. Settings, service, and extension-load diagnostics are reported on stderr. A `finally` block invalidates the temporary extension runtime, removing tracked event-bus subscriptions.

The extension bootstrap wait is bounded by the existing 15-second auth deadline. If the loader completes after that deadline, its runtime is invalidated immediately. Help, unknown subcommands, unsupported options, and missing required provider/model arguments are resolved before extension loading.

Global extensions remain trusted in-process code. The deadline stops Pi from awaiting a stuck extension factory, but Pi cannot forcibly cancel arbitrary timers, process listeners, child processes, or other side effects created directly by an extension. This is the same trust boundary as ordinary extension-enabled Pi startup. The host-level availability opt-out also cannot govern a `ModelRuntime` created privately by an extension; for example, `pi-multi-login@0.3.2` performs its own cache-only availability pass while constructing aliases.

## Patch Lifecycle

Apply or re-verify the patch:

```bash
~/.pi/agent/patches/pi-auth-extension-providers/apply.sh
```

Revert it:

```bash
~/.pi/agent/patches/pi-auth-extension-providers/revert.sh
```

Target a controlled Pi package copy:

```bash
PI_AUTH_PACKAGE_DIR="<pi-package-dir>" \
  ~/.pi/agent/patches/pi-auth-extension-providers/apply.sh
```

| Placeholder | Meaning |
| ----------- | ------- |
| `<pi-package-dir>` | Root containing the Pi package's `package.json` and `dist/main.js`. |

Without an override, the scripts resolve the package from the active `pi` executable symlink rather than assuming an npm root. They require `@earendil-works/pi-coding-agent@0.84.2` and exact SHA-256 preimages/postimages for all three installed targets. Both scripts use patch dry-runs, are idempotent, and refuse mixed or altered states. A newly applied mutation is rolled back on patch failure, verification failure, or interruption. Reversion likewise restores the patched state if exact preimage verification fails. Re-verification failure on an already-applied postimage reports the failure but intentionally leaves that previously installed state unchanged.

`PI_AUTH_PATCH_VERIFY_FILE` is a test-only verifier override. The apply script accepts it only together with `PI_AUTH_PACKAGE_DIR`, preventing implicit replacement of production verification.

## Verification

The behavioral verifier uses a temporary agent directory, local `pi-multi-login`, fake nonsecret OAuth records, and a preload that rejects common in-process network calls and system-prompt reads. It covers:

- alias and built-in auth checks;
- unknown-provider behavior;
- alias bearer-token resolution;
- clean JSON despite a noisy extension;
- stderr diagnostics;
- byte-identical `auth.json` under `--no-refresh`;
- absence of unrelated command-credential resolution during service composition;
- synchronous and deferred extension-output isolation;
- bounded extension loading and late-runtime invalidation;
- absence of `session_start`;
- extension-runtime invalidation;
- lazy help and invalid-argument paths.

Run both patch suites directly:

```bash
PI_AUTH_PACKAGE_DIR="<pi-package-dir>" \
  node --test \
  ~/.pi/agent/patches/pi-auth-extension-providers/verify-auth-extension-providers.test.mjs \
  ~/.pi/agent/patches/pi-auth-extension-providers/patch-lifecycle.test.mjs
```

## Relevant Files

| File | Purpose | Versioned |
| ---- | ------- | --------- |
| `patches/pi-auth-extension-providers/auth-extension-providers.patch` | Exact entry-point and session-services deltas for Pi `0.84.2`. | ✅ |
| `patches/pi-auth-extension-providers/apply.sh` | Guarded, verified, rollback-safe application. | ✅ |
| `patches/pi-auth-extension-providers/revert.sh` | Guarded, exact-state reversion. | ✅ |
| `patches/pi-auth-extension-providers/verify-auth-extension-providers.test.mjs` | Isolated auth behavior and safety verifier. | ✅ |
| `patches/pi-auth-extension-providers/patch-lifecycle.test.mjs` | Idempotence, version/hash refusal, and rollback tests. | ✅ |
| Installed Pi `dist/main.js` and `dist/core/agent-session-services.{js,d.ts}` | Runtime postimages; replaced by Pi package upgrades. | ❌ |

## Upgrade Boundary

A Pi upgrade replaces the installed postimage. The scripts intentionally reject every version or hash other than the audited Pi `0.84.2` states. Rebase and re-review the patch against a newer Pi release instead of weakening those guards.
