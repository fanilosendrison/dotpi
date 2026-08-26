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
- [ ] Run tests directly through Node TypeScript stripping.
- [ ] Replace Bun resolver, `?real`, module mocks, and absolute imports.
- [ ] Preserve production extension hooks, events, and telemetry schemas.
- [ ] Complete all 25 parity rows.
- [ ] Validate physical and gateway execution on Node 22 and Node 24.
- [ ] Delete the dotpi Bun lockfile only after double validation.
- [ ] Complete final documentation and Bun-allowlist sweeps.
