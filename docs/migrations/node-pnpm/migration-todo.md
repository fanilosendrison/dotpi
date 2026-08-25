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
- [!] Materialize and verify both exact packages in the independent pnpm lockfiles before replacing runtime imports.
- [ ] Add Bun 1.3.14 baseline CI with an exact dotagents commit pin.
- [ ] Add the independent pnpm 11.24.0 lockfile.
- [x] Pin Pi Coding Agent 0.84.2 and Jiti 2.7.0 in the local manifest.
- [x] Override Pi Agent Core, AI, Client, Protocol, Telemetry, and TUI to exact 0.84.2 so pnpm cannot drift to 0.84.3.
- [ ] Run tests directly through Node TypeScript stripping.
- [ ] Replace Bun resolver, `?real`, module mocks, and absolute imports.
- [ ] Preserve production extension hooks, events, and telemetry schemas.
- [ ] Complete all 25 parity rows.
- [ ] Validate physical and gateway execution on Node 22 and Node 24.
- [ ] Delete the dotpi Bun lockfile only after double validation.
- [ ] Complete final documentation and Bun-allowlist sweeps.
