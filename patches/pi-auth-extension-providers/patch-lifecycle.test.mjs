import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePackageDir = process.env.PI_AUTH_PACKAGE_DIR;
if (!sourcePackageDir) {
	throw new Error("Set PI_AUTH_PACKAGE_DIR to a supported @earendil-works/pi-coding-agent package root.");
}
const patchDir = path.dirname(fileURLToPath(import.meta.url));
const applyScript = path.join(patchDir, "apply.sh");
const revertScript = path.join(patchDir, "revert.sh");
const patchFile = path.join(patchDir, "auth-extension-providers.patch");
const expectedName = "@earendil-works/pi-coding-agent";
const expectedVersion = "0.84.2";
const targetFiles = ["dist/main.js", "dist/core/agent-session-services.js", "dist/core/agent-session-services.d.ts"];
const preimageHashes = [
	"5b340ce4b2030da40421d8a7940337f0568a927b0c2c981156733b4e067b9486",
	"3a4ee476b0596f346023398f52176381355f98dd621b8161f269c7ef3a57e28f",
	"ab5dac8701f02587db54abc27d119ea44ebd3708f235d5daf8293abd7b2ea71e",
];
const postimageHashes = [
	"24dd0e6e1c0ebf30df06d82d46e59c5276c8743c9e319ff31b9aa7a715752f53",
	"a3ae158ca07fc2f7dc8d059240b6cf3be89ebee826716147cf9424fbd8b1f6f4",
	"2f49a090f760885369baa45ab7be20fd7bac1d6a43c2d9da26f04b4e372f74e9",
];
let tempDir = "";
let successVerifier = "";
let failureVerifier = "";
let hangingVerifier = "";

function sha256(filePath) {
	return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertState(packageDir, expectedHashes) {
	for (const [index, relativePath] of targetFiles.entries()) {
		assert.equal(sha256(path.join(packageDir, relativePath)), expectedHashes[index], relativePath);
	}
}

function run(command, packageDir, verifier, cwd = tempDir) {
	return spawnSync("bash", [command], {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			PI_AUTH_PACKAGE_DIR: packageDir,
			...(verifier ? { PI_AUTH_PATCH_VERIFY_FILE: verifier } : {}),
		},
	});
}

function assertSuccess(result) {
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function assertFailure(result, pattern) {
	const output = `${result.stdout}\n${result.stderr}`;
	assert.notEqual(result.status, 0, `command unexpectedly succeeded:\n${output}`);
	assert.match(output, pattern);
}

async function interruptApplication(packageDir) {
	const child = spawn("bash", [applyScript], {
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			PI_AUTH_PACKAGE_DIR: packageDir,
			PI_AUTH_PATCH_VERIFY_FILE: hangingVerifier,
		},
	});
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (targetFiles.every((relativePath, index) => sha256(path.join(packageDir, relativePath)) === postimageHashes[index])) break;
		await delay(25);
	}
	assertState(packageDir, postimageHashes);
	process.kill(-child.pid, "SIGTERM");
	const exit = await Promise.race([
		new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
		delay(10_000, undefined, { ref: false }).then(() => ({ timeout: true })),
	]);
	if (exit.timeout) process.kill(-child.pid, "SIGKILL");
	assert.equal(exit.timeout, undefined, "interrupted apply process did not terminate");
	assert.notEqual(exit.code, 0);
}

function createPreimageFixture(version = expectedVersion) {
	const fixtureDir = fs.mkdtempSync(path.join(tempDir, "package-"));
	fs.writeFileSync(path.join(fixtureDir, "package.json"), `${JSON.stringify({ name: expectedName, version }, null, 2)}\n`, "utf8");
	for (const relativePath of targetFiles) {
		const target = path.join(fixtureDir, relativePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(path.resolve(sourcePackageDir), relativePath), target);
	}
	const sourceIsPostimage = targetFiles.every((relativePath, index) => sha256(path.join(fixtureDir, relativePath)) === postimageHashes[index]);
	if (sourceIsPostimage) {
		const reversed = spawnSync("patch", ["-p1", "-R", "-i", patchFile], { cwd: fixtureDir, encoding: "utf8" });
		assert.equal(reversed.status, 0, `${reversed.stdout}\n${reversed.stderr}`);
	}
	assertState(fixtureDir, preimageHashes);
	return fixtureDir;
}

before(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-auth-patch-lifecycle-"));
	successVerifier = path.join(tempDir, "success-verifier.test.mjs");
	failureVerifier = path.join(tempDir, "failure-verifier.test.mjs");
	hangingVerifier = path.join(tempDir, "hanging-verifier.test.mjs");
	fs.writeFileSync(successVerifier, `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
const files = ${JSON.stringify(targetFiles)};
const expected = ${JSON.stringify(postimageHashes)};
for (const [index, relativePath] of files.entries()) {
  const target = path.join(process.env.PI_AUTH_PACKAGE_DIR, relativePath);
  const actual = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  assert.equal(actual, expected[index]);
}
`, "utf8");
	fs.writeFileSync(failureVerifier, "throw new Error('intentional verifier failure');\n", "utf8");
	fs.writeFileSync(hangingVerifier, "setInterval(() => {}, 1_000);\n", "utf8");
});

after(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Pi auth extension-provider patch lifecycle", () => {
	it("applies and reverts idempotently with absolute and relative verifier overrides", () => {
		const fixtureDir = createPreimageFixture();
		assertSuccess(run(applyScript, fixtureDir, path.basename(successVerifier), path.dirname(successVerifier)));
		assertState(fixtureDir, postimageHashes);
		assertSuccess(run(applyScript, fixtureDir, successVerifier));
		assertState(fixtureDir, postimageHashes);
		assertSuccess(run(revertScript, fixtureDir));
		assertState(fixtureDir, preimageHashes);
		assertSuccess(run(revertScript, fixtureDir));
		assertState(fixtureDir, preimageHashes);
	});

	it("rejects an unsupported package version", () => {
		const fixtureDir = createPreimageFixture("0.84.3");
		assertFailure(run(applyScript, fixtureDir, successVerifier), /Expected @earendil-works\/pi-coding-agent@0\.84\.2/u);
		assertState(fixtureDir, preimageHashes);
	});

	it("rejects altered preimages and altered postimages", () => {
		const preimageFixture = createPreimageFixture();
		fs.appendFileSync(path.join(preimageFixture, targetFiles[0]), "\n// altered\n", "utf8");
		assertFailure(run(applyScript, preimageFixture, successVerifier), /neither the supported Pi 0\.84\.2 preimages nor the exact patched postimages/u);

		const postimageFixture = createPreimageFixture();
		assertSuccess(run(applyScript, postimageFixture, successVerifier));
		fs.appendFileSync(path.join(postimageFixture, targetFiles[1]), "\n// altered\n", "utf8");
		assertFailure(run(revertScript, postimageFixture), /neither the supported Pi 0\.84\.2 preimages nor the exact patched postimages/u);
	});

	it("rolls back every target when behavioral verification fails", () => {
		const fixtureDir = createPreimageFixture();
		assertFailure(run(applyScript, fixtureDir, failureVerifier), /Behavioral verification failed/u);
		assertState(fixtureDir, preimageHashes);
	});

	it("rolls back every target when application is interrupted", async () => {
		const fixtureDir = createPreimageFixture();
		await interruptApplication(fixtureDir);
		assertState(fixtureDir, preimageHashes);
	});
});
