import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";

const packageDir = process.env.PI_AUTH_PACKAGE_DIR;
if (!packageDir) {
	throw new Error("Set PI_AUTH_PACKAGE_DIR to the @earendil-works/pi-coding-agent package root.");
}
const resolvedPackageDir = path.resolve(packageDir);
const cliPath = path.join(resolvedPackageDir, "dist", "cli.js");
const defaultMultiLoginDir = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "@hank-warren", "pi-multi-login");
const multiLoginDir = path.resolve(process.env.PI_MULTI_LOGIN_PACKAGE_DIR ?? defaultMultiLoginDir);

for (const requiredPath of [cliPath, path.join(multiLoginDir, "package.json")]) {
	if (!fs.existsSync(requiredPath)) throw new Error(`Required verifier input was not found: ${requiredPath}`);
}

const aliasProvider = "openai-codex-verifier";
const baseProvider = "openai-codex";
const fakeAccessToken = "nonsecret-verifier-access-token";
const fakeRefreshToken = "nonsecret-verifier-refresh-token";
const farFutureExpiry = Date.UTC(2099, 0, 1);
let tempDir = "";
let homeDir = "";
let agentDir = "";
let projectDir = "";
let settingsPath = "";
let authPath = "";
let loadMarker = "";
let sessionMarker = "";
let invalidationMarker = "";
let deliveryMarker = "";
let credentialCommandMarker = "";
let preloadPath = "";
let syntheticAliasExtensionPath = "";
let slowExtensionPath = "";
let validSettings = "";
let validAuth = "";

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resetMarkers() {
	for (const marker of [loadMarker, sessionMarker, invalidationMarker, deliveryMarker, credentialCommandMarker]) {
		fs.rmSync(marker, { force: true });
	}
}

function runAuth(args, additionalEnvironment = {}) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd: projectDir,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: homeDir,
			USERPROFILE: homeDir,
			PI_CODING_AGENT_DIR: agentDir,
			PI_MULTI_LOGIN_CONFIG: path.join(agentDir, "pi-multi-login.json"),
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			AUTH_EXTENSION_LOAD_MARKER: loadMarker,
			AUTH_EXTENSION_SESSION_MARKER: sessionMarker,
			AUTH_EXTENSION_INVALIDATION_MARKER: invalidationMarker,
			AUTH_EXTENSION_DELIVERY_MARKER: deliveryMarker,
			AUTH_EXTENSION_CREDENTIAL_COMMAND_MARKER: credentialCommandMarker,
			AUTH_EXTENSION_PROMPT_TRAPS: [path.join(agentDir, "SYSTEM.md"), path.join(agentDir, "APPEND_SYSTEM.md")].join(path.delimiter),
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${preloadPath}`.trim(),
			...additionalEnvironment,
		},
	});
	if (result.error) throw result.error;
	assert.equal(result.signal, null, `auth subprocess terminated by ${result.signal}`);
	return result;
}

function assertJsonResult(result, expectedStatus, expectedProvider, expectedExitCode) {
	assert.equal(result.status, expectedExitCode, result.stderr);
	assert.doesNotMatch(result.stdout, /NOISY_EXTENSION_OUTPUT/u);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.status, expectedStatus);
	assert.equal(parsed.provider, expectedProvider);
	return parsed;
}

before(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-extension-providers-"));
	homeDir = path.join(tempDir, "home");
	agentDir = path.join(tempDir, "agent");
	projectDir = path.join(tempDir, "project");
	for (const directory of [homeDir, agentDir, projectDir]) fs.mkdirSync(directory, { recursive: true });

	settingsPath = path.join(agentDir, "settings.json");
	authPath = path.join(agentDir, "auth.json");
	loadMarker = path.join(tempDir, "extension-loaded");
	sessionMarker = path.join(tempDir, "session-started");
	invalidationMarker = path.join(tempDir, "runtime-invalidated");
	deliveryMarker = path.join(tempDir, "event-delivered");
	credentialCommandMarker = path.join(tempDir, "credential-command-executed");
	preloadPath = path.join(tempDir, "block-network-and-prompts.cjs");
	const noisyExtensionPath = path.join(tempDir, "noisy-extension.js");
	const failingExtensionPath = path.join(tempDir, "failing-extension.js");
	syntheticAliasExtensionPath = path.join(tempDir, "synthetic-alias-extension.js");
	slowExtensionPath = path.join(tempDir, "slow-extension.js");

	fs.writeFileSync(noisyExtensionPath, `
import * as fs from "node:fs";
export default function authVerifierExtension(pi) {
  process.stdout.write("NOISY_EXTENSION_OUTPUT\\n");
  fs.writeFileSync(process.env.AUTH_EXTENSION_LOAD_MARKER, "loaded");
  pi.registerFlag("auth-extension-verifier", { description: "Verifier flag", type: "boolean" });
  pi.events.on("auth-extension-verifier", () => fs.writeFileSync(process.env.AUTH_EXTENSION_DELIVERY_MARKER, "delivered"));
  pi.on("session_start", () => fs.writeFileSync(process.env.AUTH_EXTENSION_SESSION_MARKER, "started"));
  process.once("beforeExit", () => {
    process.stdout.write("DELAYED_NOISY_EXTENSION_OUTPUT\\n");
    let state = "active";
    try { pi.events.emit("auth-extension-verifier", {}); }
    catch { state = "invalidated"; }
    fs.writeFileSync(process.env.AUTH_EXTENSION_INVALIDATION_MARKER, state);
  });
}
`, "utf8");
	fs.writeFileSync(failingExtensionPath, "export default function failingExtension() { throw new Error('synthetic extension failure'); }\n", "utf8");
	fs.writeFileSync(syntheticAliasExtensionPath, `
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
export default async function syntheticAliasExtension(pi) {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const source = runtime.getProvider("openai-codex");
  const id = "openai-codex-isolated-verifier";
  const models = source.getModels().map((model) => ({ ...model, provider: id }));
  pi.registerProvider({ ...source, id, name: "Isolated verifier", getModels: () => models, refreshModels: undefined });
}
`, "utf8");
	fs.writeFileSync(slowExtensionPath, `
import * as fs from "node:fs";
export default async function slowExtension(pi) {
  pi.events.on("slow-extension-verifier", () => {});
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.once("beforeExit", () => {
    let state = "active";
    try { pi.events.emit("slow-extension-verifier", {}); }
    catch { state = "invalidated"; }
    fs.writeFileSync(process.env.AUTH_EXTENSION_INVALIDATION_MARKER, state);
  });
}
`, "utf8");
	fs.writeFileSync(preloadPath, `
const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const traps = new Set((process.env.AUTH_EXTENSION_PROMPT_TRAPS || "").split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry)));
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function guardedReadFileSync(file, ...args) {
  if (typeof file === "string" && traps.has(path.resolve(file))) throw new Error("prompt trap consumed: " + file);
  return originalReadFileSync.call(this, file, ...args);
};
syncBuiltinESMExports();
const blocked = () => { throw new Error("network access is forbidden by the auth verifier"); };
globalThis.fetch = blocked;
if (process.env.AUTH_EXTENSION_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  AbortSignal.timeout = () => timeout(Number(process.env.AUTH_EXTENSION_TIMEOUT_MS));
}
for (const [moduleName, methods] of [["node:net", ["connect", "createConnection"]], ["node:tls", ["connect"]], ["node:http", ["request", "get"]], ["node:https", ["request", "get"]]]) {
  const module = require(moduleName);
  for (const method of methods) module[method] = blocked;
}
`, "utf8");
	fs.writeFileSync(path.join(agentDir, "SYSTEM.md"), "PROMPT_TRAP", "utf8");
	fs.writeFileSync(path.join(agentDir, "APPEND_SYSTEM.md"), "APPEND_PROMPT_TRAP", "utf8");
	writeJson(path.join(agentDir, "pi-multi-login.json"), {
		aliases: [{ base: baseProvider, suffix: "verifier", name: "Verifier Alias" }],
	});
	validAuth = `${JSON.stringify({
		[baseProvider]: { type: "oauth", access: "nonsecret-base-token", refresh: fakeRefreshToken, expires: farFutureExpiry, accountId: "base-verifier" },
		[aliasProvider]: { type: "oauth", access: fakeAccessToken, refresh: fakeRefreshToken, expires: farFutureExpiry, accountId: "alias-verifier" },
		"openai-codex-isolated-verifier": { type: "oauth", access: "nonsecret-isolated-token", refresh: fakeRefreshToken, expires: farFutureExpiry, accountId: "isolated-verifier" },
	}, null, 2)}\n`;
	fs.writeFileSync(authPath, validAuth, "utf8");
	validSettings = `${JSON.stringify({ packages: [multiLoginDir, noisyExtensionPath, failingExtensionPath] }, null, 2)}\n`;
	fs.writeFileSync(settingsPath, validSettings, "utf8");
});

after(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Pi auth extension-provider bootstrap", () => {
	it("resolves an extension alias with clean JSON, no session, no prompt reads, and no network", () => {
		resetMarkers();
		const authBefore = fs.readFileSync(authPath, "utf8");
		const result = runAuth(["auth", "check", "--provider", aliasProvider, "--json", "--no-refresh"]);
		const parsed = assertJsonResult(result, "ready", aliasProvider, 0);
		assert.equal(parsed.authType, "oauth");
		assert.match(result.stderr, /NOISY_EXTENSION_OUTPUT/u);
		assert.match(result.stderr, /Failed to load extension/u);
		assert.equal(fs.readFileSync(authPath, "utf8"), authBefore, "--no-refresh modified auth.json");
		assert.equal(fs.existsSync(sessionMarker), false, "auth command emitted session_start");
		assert.equal(fs.readFileSync(invalidationMarker, "utf8"), "invalidated");
		assert.equal(fs.existsSync(deliveryMarker), false, "event subscription survived runtime invalidation");
	});

	it("does not inspect unrelated credentials during service composition", () => {
		const isolatedSettings = `${JSON.stringify({ packages: [syntheticAliasExtensionPath] }, null, 2)}\n`;
		const authWithCommandCredential = JSON.parse(validAuth);
		authWithCommandCredential.anthropic = {
			type: "api_key",
			key: "!printf executed > \"$AUTH_EXTENSION_CREDENTIAL_COMMAND_MARKER\"",
		};
		fs.writeFileSync(settingsPath, isolatedSettings, "utf8");
		writeJson(authPath, authWithCommandCredential);
		try {
			resetMarkers();
			const result = runAuth(["auth", "check", "--provider", "openai-codex-isolated-verifier", "--json", "--no-refresh"]);
			assertJsonResult(result, "ready", "openai-codex-isolated-verifier", 0);
			assert.equal(fs.existsSync(credentialCommandMarker), false, "service composition resolved an unrelated command credential");
		} finally {
			fs.writeFileSync(settingsPath, validSettings, "utf8");
			fs.writeFileSync(authPath, validAuth, "utf8");
		}
	});

	it("bounds extension loading and invalidates a runtime that completes after the deadline", () => {
		fs.writeFileSync(settingsPath, `${JSON.stringify({ packages: [slowExtensionPath] }, null, 2)}\n`, "utf8");
		try {
			resetMarkers();
			const startedAt = Date.now();
			const result = runAuth(["auth", "check", "--provider", baseProvider, "--json", "--no-refresh"], {
				AUTH_EXTENSION_TIMEOUT_MS: "100",
			});
			assertJsonResult(result, "invalid", baseProvider, 2);
			assert.ok(Date.now() - startedAt < 5_000, "auth bootstrap ignored its deadline");
			assert.equal(fs.readFileSync(invalidationMarker, "utf8"), "invalidated");
		} finally {
			fs.writeFileSync(settingsPath, validSettings, "utf8");
		}
	});

	it("preserves built-in, unknown-provider, and bearer-token behavior", () => {
		assertJsonResult(runAuth(["auth", "check", "--provider", baseProvider, "--json", "--no-refresh"]), "ready", baseProvider, 0);
		assertJsonResult(runAuth(["auth", "check", "--provider", "provider-that-does-not-exist", "--json", "--no-refresh"]), "not_ready", "provider-that-does-not-exist", 1);
		const bearer = runAuth(["auth", "print-bearer-token", "--provider", aliasProvider, "--min-expiry", "0ms"]);
		assert.equal(bearer.status, 0, bearer.stderr);
		assert.equal(bearer.stdout, `${fakeAccessToken}\n`);
		assert.doesNotMatch(bearer.stdout, /NOISY_EXTENSION_OUTPUT/u);
	});

	it("does not load extensions for help or invalid command arguments", () => {
		for (const args of [
			["auth", "--help"],
			["auth", "unknown"],
			["auth", "print-bearer-token"],
			["auth", "check", "--provider", aliasProvider, "--unsupported"],
		]) {
			resetMarkers();
			runAuth(args);
			assert.equal(fs.existsSync(loadMarker), false, `extensions loaded for: ${args.join(" ")}`);
		}
	});

	it("reports settings diagnostics on stderr without contaminating stdout", () => {
		fs.writeFileSync(settingsPath, "{ invalid settings", "utf8");
		try {
			const result = runAuth(["auth", "check", "--provider", baseProvider, "--json", "--no-refresh"]);
			assertJsonResult(result, "ready", baseProvider, 0);
			assert.match(result.stderr, /auth command runtime creation/u);
		} finally {
			fs.writeFileSync(settingsPath, validSettings, "utf8");
		}
	});
});
