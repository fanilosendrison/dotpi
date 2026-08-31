# Retired Bun test baseline

This directory preserves the 25 historical test surfaces and their Bun-specific
loader declarations after successful differential migration. The files are not
part of the active TypeScript project, package boundary, test runner, extension
loader, or CI workflow.

Original locations remain recorded as `sourceFile` values in
`../../test-parity.json`; active Node successors remain at each corresponding
`targetFile`. All 25 successors were green before the baseline moved here.

Do not restore these files to active extension paths. A future interoperability
need must be opt-in, must not alter the Node default, and must have an exact
entry in `../../bun-allowlist.json`.
