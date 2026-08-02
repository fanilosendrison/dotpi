import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TEMP_ARTIFACTS_DIR, type ArtifactPaths } from "./types.ts";
import { getAgentDir } from "./utils.ts";

const CLEANUP_MARKER_FILE = ".last-cleanup";
const CLEANUP_MARKER_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PROJECTS_DIRECTORY_NAME = "projects";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

type FileSnapshot = Readonly<{
	name: string;
	dev: number;
	ino: number;
	mtimeMs: number;
}>;

function isNotFoundError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "code" in error
		&& (error as NodeJS.ErrnoException).code === "ENOENT";
}

function readLstat(filePath: string): fs.Stats | undefined {
	try {
		return fs.lstatSync(filePath);
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw error;
	}
}

function isSafeDirectory(stats: fs.Stats): boolean {
	return stats.isDirectory() && !stats.isSymbolicLink();
}

function isSafeRegularFile(stats: fs.Stats): boolean {
	return stats.isFile() && !stats.isSymbolicLink();
}

function isPathWithin(directory: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(directory));
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function ensurePrivateDirectory(directory: string): void {
	fs.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	const stats = fs.lstatSync(directory);
	if (!isSafeDirectory(stats)) {
		throw new Error(`Artifact directory must be a non-symlink directory: ${directory}`);
	}
	if (process.platform !== "win32") fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE);
}

function canonicalizePath(directory: string): string {
	const resolved = path.resolve(directory);
	try {
		return fs.realpathSync.native(resolved);
	} catch {
		return resolved;
	}
}

function findProjectArtifactRoot(cwd: string): string {
	const canonicalCwd = canonicalizePath(cwd);
	let current = canonicalCwd;
	while (true) {
		const gitMarker = readLstat(path.join(current, ".git"));
		if (gitMarker && (gitMarker.isDirectory() || gitMarker.isFile())) return current;
		const parent = path.dirname(current);
		if (parent === current) return canonicalCwd;
		current = parent;
	}
}

function projectScopeName(cwd: string): string {
	const projectRoot = findProjectArtifactRoot(cwd);
	const basename = path.basename(projectRoot)
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "project";
	const digest = createHash("sha256").update(projectRoot).digest("hex");
	return `${basename}--${digest}`;
}

export function getUserSubagentsDir(homeDir: string = os.homedir()): string {
	return path.join(path.resolve(homeDir), ".pi-subagents");
}

export function getProjectSubagentsDir(cwd: string, homeDir: string = os.homedir()): string {
	return path.join(getUserSubagentsDir(homeDir), PROJECTS_DIRECTORY_NAME, projectScopeName(cwd));
}

export function getProjectArtifactsDir(cwd: string, homeDir: string = os.homedir()): string {
	return path.join(getProjectSubagentsDir(cwd, homeDir), "artifacts");
}

export function getProjectChainRunsDir(cwd: string, homeDir: string = os.homedir()): string {
	return path.join(getProjectSubagentsDir(cwd, homeDir), "chain-runs");
}

export function ensureProjectChainRunsDir(cwd: string, homeDir: string = os.homedir()): string {
	const userSubagentsDir = getUserSubagentsDir(homeDir);
	const chainRunsDir = getProjectChainRunsDir(cwd, homeDir);
	ensureArtifactsDir(chainRunsDir, userSubagentsDir);
	return chainRunsDir;
}

export function getArtifactsDir(sessionFile: string | null, projectCwd?: string, homeDir: string = os.homedir()): string {
	if (projectCwd) return getProjectArtifactsDir(projectCwd, homeDir);
	if (sessionFile) {
		const sessionDir = path.dirname(sessionFile);
		return path.join(sessionDir, "subagent-artifacts");
	}
	return TEMP_ARTIFACTS_DIR;
}

export function getArtifactPaths(artifactsDir: string, runId: string, agent: string, index?: number): ArtifactPaths {
	const suffix = index !== undefined ? `_${index}` : "";
	const safeAgent = agent.replace(/[^\w.-]/g, "_");
	const base = `${runId}_${safeAgent}${suffix}`;
	return {
		inputPath: path.join(artifactsDir, `${base}_input.md`),
		outputPath: path.join(artifactsDir, `${base}_output.md`),
		jsonlPath: path.join(artifactsDir, `${base}.jsonl`),
		transcriptPath: path.join(artifactsDir, `${base}_transcript.jsonl`),
		metadataPath: path.join(artifactsDir, `${base}_meta.json`),
	};
}

export function ensureArtifactsDir(dir: string, userSubagentsDir: string = getUserSubagentsDir()): void {
	const resolvedDir = path.resolve(dir);
	const resolvedUserSubagentsDir = path.resolve(userSubagentsDir);
	if (!isPathWithin(resolvedDir, resolvedUserSubagentsDir)) {
		ensurePrivateDirectory(resolvedDir);
		return;
	}

	ensurePrivateDirectory(resolvedUserSubagentsDir);
	const relativeSegments = path.relative(resolvedUserSubagentsDir, resolvedDir)
		.split(path.sep)
		.filter(Boolean);
	let current = resolvedUserSubagentsDir;
	for (const segment of relativeSegments) {
		current = path.join(current, segment);
		ensurePrivateDirectory(current);
	}
}

export function writeArtifact(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
}

export function writeMetadata(filePath: string, metadata: object): void {
	fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
}

export function appendJsonl(filePath: string, line: string): void {
	fs.appendFileSync(filePath, `${line}\n`, { encoding: "utf-8", mode: PRIVATE_FILE_MODE });
}

function readCleanupMarkerIsFresh(directory: string, now: number): boolean {
	const markerPath = path.join(directory, CLEANUP_MARKER_FILE);
	const marker = readLstat(markerPath);
	return marker !== undefined && isSafeRegularFile(marker) && now - marker.mtimeMs < CLEANUP_MARKER_INTERVAL_MS;
}

function createCleanupMarkerIfMissing(directory: string, now: number): void {
	const markerPath = path.join(directory, CLEANUP_MARKER_FILE);
	if (readLstat(markerPath) !== undefined) return;

	let descriptor: number | undefined;
	try {
		descriptor = fs.openSync(markerPath, "wx", PRIVATE_FILE_MODE);
		fs.writeFileSync(descriptor, String(now), "utf-8");
	} catch (error) {
		if (!isNotFoundError(error) && !(typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) {
			throw error;
		}
	} finally {
		if (descriptor !== undefined) fs.closeSync(descriptor);
	}
}

function safeFileSnapshot(directory: string, name: string): FileSnapshot | undefined {
	const stats = readLstat(path.join(directory, name));
	if (!stats || !isSafeRegularFile(stats)) return undefined;
	return { name, dev: stats.dev, ino: stats.ino, mtimeMs: stats.mtimeMs };
}

function matchesSnapshot(directory: string, snapshot: FileSnapshot, cutoff: number): boolean {
	const current = safeFileSnapshot(directory, snapshot.name);
	return current !== undefined
		&& current.dev === snapshot.dev
		&& current.ino === snapshot.ino
		&& current.mtimeMs === snapshot.mtimeMs
		&& current.mtimeMs < cutoff;
}

function listDirectoryEntries(directory: string): string[] {
	try {
		return fs.readdirSync(directory);
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw error;
	}
}

function cleanupSnapshots(directory: string, snapshots: readonly FileSnapshot[], cutoff: number): void {
	for (const snapshot of snapshots) {
		if (!matchesSnapshot(directory, snapshot, cutoff)) continue;
		try {
			fs.unlinkSync(path.join(directory, snapshot.name));
		} catch {
			// Cleanup is best effort. The entry can disappear or change after revalidation.
		}
	}
}

export function cleanupOldArtifacts(dir: string, maxAgeDays: number): void {
	const directoryStats = readLstat(dir);
	if (!directoryStats || !isSafeDirectory(directoryStats)) return;

	const now = Date.now();
	if (readCleanupMarkerIsFresh(dir, now)) return;
	const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
	const snapshots = listDirectoryEntries(dir)
		.filter((name) => name !== CLEANUP_MARKER_FILE)
		.map((name) => safeFileSnapshot(dir, name))
		.filter((snapshot): snapshot is FileSnapshot => snapshot !== undefined && snapshot.mtimeMs < cutoff);
	cleanupSnapshots(dir, snapshots, cutoff);
	createCleanupMarkerIfMissing(dir, now);
}

function cleanupCompletedArtifactGroups(dir: string, maxAgeDays: number): void {
	const directoryStats = readLstat(dir);
	if (!directoryStats || !isSafeDirectory(directoryStats)) return;

	const now = Date.now();
	if (readCleanupMarkerIsFresh(dir, now)) return;
	const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
	const entries = new Set(listDirectoryEntries(dir).filter((name) => name !== CLEANUP_MARKER_FILE));
	const metadataNames = [...entries].filter((name) => name.endsWith("_meta.json"));

	for (const metadataName of metadataNames) {
		const groupKey = metadataName.slice(0, -"_meta.json".length);
		if (!groupKey) continue;
		const groupEntries = [
			`${groupKey}_input.md`,
			`${groupKey}_output.md`,
			`${groupKey}.jsonl`,
			`${groupKey}_transcript.jsonl`,
			metadataName,
		].filter((name) => entries.has(name));
		const snapshots = groupEntries.map((name) => safeFileSnapshot(dir, name));
		if (snapshots.some((snapshot) => snapshot === undefined)) continue;
		const completeSnapshots = snapshots as FileSnapshot[];
		if (completeSnapshots.length === 0 || !completeSnapshots.every((snapshot) => snapshot.mtimeMs < cutoff)) continue;
		cleanupSnapshots(dir, completeSnapshots, cutoff);
	}

	createCleanupMarkerIfMissing(dir, now);
}

export function cleanupGlobalProjectArtifactDirs(maxAgeDays: number, homeDir: string = os.homedir()): void {
	const projectsDir = path.join(getUserSubagentsDir(homeDir), PROJECTS_DIRECTORY_NAME);
	const projectsStats = readLstat(projectsDir);
	if (!projectsStats || !isSafeDirectory(projectsStats)) return;

	for (const projectScopeName of listDirectoryEntries(projectsDir)) {
		const projectScopeDir = path.join(projectsDir, projectScopeName);
		const projectScopeStats = readLstat(projectScopeDir);
		if (!projectScopeStats || !isSafeDirectory(projectScopeStats)) continue;
		cleanupCompletedArtifactGroups(path.join(projectScopeDir, "artifacts"), maxAgeDays);
	}
}

export function cleanupAllArtifactDirs(maxAgeDays: number): void {
	cleanupOldArtifacts(TEMP_ARTIFACTS_DIR, maxAgeDays);
	cleanupGlobalProjectArtifactDirs(maxAgeDays);

	const sessionsBase = path.join(getAgentDir(), "sessions");
	const sessionsStats = readLstat(sessionsBase);
	if (!sessionsStats || !isSafeDirectory(sessionsStats)) return;

	let dirs: string[];
	try {
		dirs = fs.readdirSync(sessionsBase);
	} catch {
		// Session cleanup is best effort. If the sessions root cannot be read, skip it.
		return;
	}

	for (const dir of dirs) {
		const sessionDir = path.join(sessionsBase, dir);
		const sessionStats = readLstat(sessionDir);
		if (!sessionStats || !isSafeDirectory(sessionStats)) continue;
		try {
			cleanupOldArtifacts(path.join(sessionDir, "subagent-artifacts"), maxAgeDays);
		} catch {
			// Keep processing other session directories if one is unreadable.
		}
	}
}
