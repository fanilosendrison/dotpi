import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	appendJsonl,
	cleanupGlobalProjectArtifactDirs,
	cleanupOldArtifacts,
	ensureArtifactsDir,
	getArtifactsDir,
	getProjectArtifactsDir,
	getProjectChainRunsDir,
	getProjectSubagentsDir,
	getUserSubagentsDir,
	writeArtifact,
	writeMetadata,
} from "../../src/shared/artifacts.ts";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-artifacts-"));
}

function removeTempDir(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

function makeOld(filePath: string): void {
	const old = new Date(Date.now() - 60_000);
	fs.utimesSync(filePath, old, old);
}

function assertPrivateDirectory(dir: string): void {
	if (process.platform === "win32") return;
	assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
}

function assertPrivateFile(filePath: string): void {
	if (process.platform === "win32") return;
	assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
}

describe("user-global project artifact paths", () => {
	it("scopes artifacts to a canonical Git root outside the project cwd", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const repositoryRoot = path.join(root, "repo");
			const nestedCwd = path.join(repositoryRoot, "packages", "child");
			fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
			fs.mkdirSync(nestedCwd, { recursive: true });

			const projectDir = getProjectSubagentsDir(repositoryRoot, homeDir);
			assert.equal(getProjectSubagentsDir(nestedCwd, homeDir), projectDir);
			assert.match(path.basename(projectDir), /^repo--[a-f0-9]{64}$/);
			assert.equal(path.dirname(path.dirname(projectDir)), path.join(homeDir, ".pi-subagents"));
			assert.equal(getProjectArtifactsDir(repositoryRoot, homeDir), path.join(projectDir, "artifacts"));
			assert.equal(getProjectChainRunsDir(repositoryRoot, homeDir), path.join(projectDir, "chain-runs"));
			assert.equal(getArtifactsDir(null, nestedCwd, homeDir), path.join(projectDir, "artifacts"));
		} finally {
			removeTempDir(root);
		}
	});

	it("separates distinct worktrees and recognizes a .git file as a worktree marker", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const firstWorktree = path.join(root, "first-worktree");
			const secondWorktree = path.join(root, "second-worktree");
			fs.mkdirSync(path.join(firstWorktree, ".git"), { recursive: true });
			fs.mkdirSync(secondWorktree, { recursive: true });
			fs.writeFileSync(path.join(secondWorktree, ".git"), "gitdir: /tmp/gitdir\n");

			assert.notEqual(
				getProjectSubagentsDir(firstWorktree, homeDir),
				getProjectSubagentsDir(secondWorktree, homeDir),
			);
		} finally {
			removeTempDir(root);
		}
	});

	it("uses each canonical cwd as the scope outside Git", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const firstCwd = path.join(root, "first-outside-git");
			const secondCwd = path.join(root, "second-outside-git");
			fs.mkdirSync(firstCwd);
			fs.mkdirSync(secondCwd);

			const firstProjectDir = getProjectSubagentsDir(firstCwd, homeDir);
			const secondProjectDir = getProjectSubagentsDir(secondCwd, homeDir);
			assert.match(path.basename(firstProjectDir), /^first-outside-git--[a-f0-9]{64}$/);
			assert.notEqual(firstProjectDir, secondProjectDir);
		} finally {
			removeTempDir(root);
		}
	});

	it("keeps the session artifact fallback when no project cwd is available", () => {
		const sessionFile = path.join("tmp", "sessions", "parent.jsonl");
		assert.equal(getArtifactsDir(sessionFile), path.join("tmp", "sessions", "subagent-artifacts"));
	});
});

describe("artifact privacy", () => {
	it("creates global artifact directories and files with private permissions", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const repositoryRoot = path.join(root, "repo");
			fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
			const artifactsDir = getProjectArtifactsDir(repositoryRoot, homeDir);
			const inputPath = path.join(artifactsDir, "run_worker_input.md");
			const metadataPath = path.join(artifactsDir, "run_worker_meta.json");
			const transcriptPath = path.join(artifactsDir, "run_worker_transcript.jsonl");

			ensureArtifactsDir(artifactsDir);
			writeArtifact(inputPath, "input");
			writeMetadata(metadataPath, { completed: true });
			appendJsonl(transcriptPath, "{\"event\":\"done\"}");

			assertPrivateDirectory(getUserSubagentsDir(homeDir));
			assertPrivateDirectory(path.dirname(path.dirname(artifactsDir)));
			assertPrivateDirectory(artifactsDir);
			assertPrivateFile(inputPath);
			assertPrivateFile(metadataPath);
			assertPrivateFile(transcriptPath);
		} finally {
			removeTempDir(root);
		}
	});
});

describe("global artifact cleanup", () => {
	it("removes only completed old artifact groups and preserves incomplete groups", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const repositoryRoot = path.join(root, "repo");
			fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
			const artifactsDir = getProjectArtifactsDir(repositoryRoot, homeDir);
			ensureArtifactsDir(artifactsDir);

			const completedInput = path.join(artifactsDir, "completed_worker_input.md");
			const completedJsonl = path.join(artifactsDir, "completed_worker.jsonl");
			const completedMetadata = path.join(artifactsDir, "completed_worker_meta.json");
			const prefixCollisionInput = path.join(artifactsDir, "completed_worker_followup_input.md");
			const pendingInput = path.join(artifactsDir, "pending_worker_input.md");
			writeArtifact(completedInput, "completed");
			appendJsonl(completedJsonl, "{\"event\":\"completed\"}");
			writeMetadata(completedMetadata, { completed: true });
			writeArtifact(prefixCollisionInput, "incomplete follow-up");
			writeArtifact(pendingInput, "pending");
			makeOld(completedInput);
			makeOld(completedJsonl);
			makeOld(completedMetadata);
			makeOld(prefixCollisionInput);
			makeOld(pendingInput);

			cleanupGlobalProjectArtifactDirs(0, homeDir);

			assert.equal(fs.existsSync(completedInput), false);
			assert.equal(fs.existsSync(completedJsonl), false);
			assert.equal(fs.existsSync(completedMetadata), false);
			assert.equal(fs.existsSync(prefixCollisionInput), true);
			assert.equal(fs.existsSync(pendingInput), true);
		} finally {
			removeTempDir(root);
		}
	});

	it("never follows or removes symlink artifacts and cleanup markers", () => {
		const root = makeTempDir();
		try {
			const homeDir = path.join(root, "home");
			const repositoryRoot = path.join(root, "repo");
			const target = path.join(root, "target.txt");
			fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
			fs.writeFileSync(target, "keep");
			const artifactsDir = getProjectArtifactsDir(repositoryRoot, homeDir);
			ensureArtifactsDir(artifactsDir);

			const markerPath = path.join(artifactsDir, ".last-cleanup");
			fs.symlinkSync(target, markerPath);
			const legacyFile = path.join(artifactsDir, "old.txt");
			writeArtifact(legacyFile, "old");
			makeOld(legacyFile);
			cleanupOldArtifacts(artifactsDir, 0);
			assert.equal(fs.existsSync(legacyFile), false);
			assert.equal(fs.lstatSync(markerPath).isSymbolicLink(), true);
			assert.equal(fs.readFileSync(target, "utf-8"), "keep");

			const inputPath = path.join(artifactsDir, "protected_worker_input.md");
			const metadataPath = path.join(artifactsDir, "protected_worker_meta.json");
			const outputPath = path.join(artifactsDir, "protected_worker_output.md");
			writeArtifact(inputPath, "input");
			writeMetadata(metadataPath, { completed: true });
			fs.symlinkSync(target, outputPath);
			makeOld(inputPath);
			makeOld(metadataPath);

			cleanupGlobalProjectArtifactDirs(0, homeDir);

			assert.equal(fs.existsSync(inputPath), true);
			assert.equal(fs.existsSync(metadataPath), true);
			assert.equal(fs.lstatSync(outputPath).isSymbolicLink(), true);
			assert.equal(fs.readFileSync(target, "utf-8"), "keep");
		} finally {
			removeTempDir(root);
		}
	});
});
