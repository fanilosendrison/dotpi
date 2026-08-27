---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "node-pnpm-migration-todo"
workspace: "dotpi"
date: "2026-08-25"
step_id: 0
---

# Dotpi Node test migration to-do

- [x] Create `migration/node-pnpm`.
- [x] Annotate `pre-node-pnpm-raw`.
- [x] Reconstruct source and documentation gateway links without replacing private runtime configuration.
- [x] Confirm 25 direct Bun tests.
- [x] Keep `extensions/pi-subagents-4-turnlock/**` explicitly excluded.
- [x] Generate and validate the machine-readable inventory and parity manifest.
- [x] Verify immutable event-sink 0.1.0 registry publication, integrity, and clean installation.
- [x] Verify Node-compatible turnlock 0.9.1 registry publication, byte-identical pnpm pack reproduction, and clean runtime plus TypeScript installation.
- [x] Declare exact event-sink 0.1.0 locally and exact Turnlock 0.9.1 in its dotagents consumer before replacing runtime imports.
- [x] Materialize and verify both exact packages in independent pnpm lockfiles; defer runtime import replacement until green baseline gates pass.
- [x] Add Bun 1.3.14 baseline CI on Linux/macOS with exact dotagents commit `3516a87e52b51e607fad387703a0b47c99751adf` and all 25 inventoried surfaces.
- [x] Run all 25 historical surfaces on Linux and macOS; run `32941844069` passes with the unchanged enforced security message.
- [x] Publish `pre-node-pnpm-raw` and `pre-node-pnpm-green`; the green tag targets `49f90083421e4ce40057807ec41d671184166d82`.
- [x] Add the independent root-only pnpm 11.24.0 lockfile, exclude the upstream package, and pass two clean frozen installations.
- [x] Pin Pi Coding Agent 0.84.2 and Jiti 2.7.0 in the local manifest.
- [x] Override Pi Agent Core, AI, Client, Protocol, Telemetry, and TUI to exact 0.84.2 so pnpm cannot drift to 0.84.3.
- [x] Replace active event-sink source imports and mock keys with the exact public package, and remove its source checkout and compatibility alias from Bun CI.
- [x] Start direct Node TypeScript stripping with a `node:test` event-envelope smoke; Node run `32947362470` passes on Node 22.19.0/24 Linux/macOS without Bun, and retained Bun run `32947362415` passes on Linux/macOS.
- [x] Map `command-validator.contract.test.ts` to a separate Node parity target with the same four test identities and no normative change; Node run `32966415836` and retained Bun run `32966415806` pass on Linux/macOS.
- [x] Map `git-commits-push-enforcer.contract.test.ts` to a separate Node parity target with the same five test identities and no normative change; Node run `32967954525` and retained Bun run `32967954588` pass on Linux/macOS.
- [x] Map `path-guard.contract.test.ts` to a separate Node parity target with the same four test identities and no normative change; Node run `32968724147` and retained Bun run `32968724145` pass on Linux/macOS.
- [x] Map `permission-enforcer.contract.test.ts` to a separate Node parity target with the same two test identities and no normative change; Node run `32969576280` and retained Bun run `32969576249` pass on Linux/macOS.
- [x] Map `read-deduplicator.contract.test.ts` to a separate Node parity target with the same three test identities and no normative change; Node run `32970342843` and retained Bun run `32970342867` pass on Linux/macOS.
- [x] Map `zero-timeout-filter.contract.test.ts` to a separate Node parity target with its single test identity and no normative change; Node run `32971051645` and retained Bun run `32971051840` pass on Linux/macOS.
- [x] Map `cwd-args.test.ts` to a separate Node parity target with the same eleven declared identities, fifteen runtime cases, and no normative change; Node run `32972014124` and retained Bun run `32972014134` pass on Linux/macOS.
- [x] Map `read-deduplicator.test.ts` to a separate Node parity target with the same eleven test identities and no normative change; Node run `32999890715` and retained Bun run `32999890719` pass on Linux/macOS.
- [x] Map `enhanced-model-selector.test.ts` to a separate Node parity target with the same five test identities, twenty-seven assertions, and no normative change; Node run `33001418971` and retained Bun run `33001419030` pass on Linux/macOS.
- [x] Map `extended-global-context.test.ts` to a separate Node parity target with the same six test identities, twenty assertions, and no normative change; Node run `33002649005` and retained Bun run `33002648976` pass on Linux/macOS.
- [x] Map `read-deduplicator-internals/read-tracker.test.ts` to a separate Node parity target with the same seventeen test identities, thirty-five assertions, and no normative change; Node run `33003537512` and retained Bun run `33003537491` pass on Linux/macOS.
- [x] Map `cwd-browser.test.ts` to a separate Node parity target with the same nine test identities, twenty assertions, and no normative change; the equivalent erasable class property and workspace hoist pass Node run `33004764181` and retained Bun run `33004764194` on Linux/macOS.
- [x] Map `cwd-handler.test.ts` to a separate Node parity target with the same five test identities, twelve assertions, explicit `.ts` runtime imports, and no normative change; Node run `33005784624` and retained Bun run `33005784598` pass on Linux/macOS.
- [x] Map `cwd-interactive.test.ts` to a separate Node parity target with the same three test identities, seven assertions, and no normative change; Node run `33007058682` and retained Bun run `33007058690` pass on Linux/macOS.
- [x] Map `cwd-extension.test.ts` to a separate Node parity target with its single test identity, four assertions, explicit `.ts` entrypoint exports, and no normative change; Node run `33008062284` and retained Bun run `33008062299` pass on Linux/macOS.
- [x] Map `git-commits-push-enforcer.test.ts` to a separate Node parity target with the same three test identities, sixteen assertions, a shared Node/Jiti Pi extension loader, and no normative change; Node run `33047401971` and retained Bun run `33047401959` pass on Linux/macOS after explicit CI gateways.
- [x] Map `zero-timeout-filter.test.ts` to a separate Node parity target with the same twelve test identities, twenty-six assertions, real telemetry, and no normative change; Node run `33048642717` and retained Bun run `33048642721` pass on Linux/macOS.
- [x] Map `path-guard.test.ts` to a separate Node parity target with its single test identity, seventeen assertions, real path rewrites and telemetry, and no normative change; Node run `33049961825` and retained Bun run `33049961826` pass on Linux/macOS.
- [x] Map `permission-enforcer.integration.test.ts` to a separate Node parity target with its single test identity, fourteen assertions, an isolated Node subprocess, real state and real telemetry, and no normative change; Node run `33051148966` and retained Bun run `33051149059` pass on Linux/macOS.
- [x] Map `permission-enforcer.test.ts` to a separate Node parity target with the same four test identities, five assertions, Jiti cache isolation, real state and no normative change; Node run `33052380562` and retained Bun run `33052380601` pass on Linux/macOS.
- [x] Map `permission-enforcer.e2e.test.ts` to a separate Node parity target with its single test identity, fourteen assertions, two real Pi sessions, an isolated Node subprocess, real state and real telemetry, and no normative change; Node run `33057732503` and retained Bun run `33057732483` pass on Linux/macOS.
- [x] Map `command-validator.test.ts` to a separate Node parity target with its single test identity, nine assertions, Jiti cache isolation, real permission state and no normative change; Node run `33068934808` and retained Bun run `33068934762` pass on Linux/macOS.
- [!] Map `git-commits-push-enforcer.integration.test.ts` to a separate Node parity target with the same five test identities, twenty-three static assertions, isolated Node probes, real telemetry and no normative change; local Node 22.19.0 passes while cross-platform evidence remains pending.
- [ ] Run tests directly through Node TypeScript stripping.
- [ ] Replace Bun resolver, `?real`, module mocks, and absolute imports.
- [ ] Preserve production extension hooks, events, and telemetry schemas.
- [ ] Complete all 25 parity rows.
- [ ] Validate physical and gateway execution on Node 22 and Node 24.
- [ ] Delete the dotpi Bun lockfile only after double validation.
- [ ] Complete final documentation and Bun-allowlist sweeps.
