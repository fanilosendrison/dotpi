import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface JitiInstance {
	import(id: string, options: { default: true }): Promise<unknown>;
	import(id: string): Promise<unknown>;
}

interface JitiStaticModule {
	createJiti(url: string, options: { moduleCache: false }): JitiInstance;
}

async function createPiTestJiti(): Promise<JitiInstance> {
	const jitiStaticPath = resolveJitiStaticPath();
	const jitiModule = (await import(
		pathToFileURL(jitiStaticPath).href
	)) as JitiStaticModule;

	return jitiModule.createJiti(import.meta.url, {
		moduleCache: false,
	});
}

function resolveJitiStaticPath(): string {
	try {
		return Bun.resolveSync("jiti/static", homedir());
	} catch {
		const npmRoot = execFileSync("npm", ["root", "-g"], {
			encoding: "utf-8",
		}).trim();
		return join(
			npmRoot,
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"jiti",
			"lib",
			"jiti-static.mjs",
		);
	}
}

let jitiPromise: Promise<JitiInstance> | undefined;

function getPiTestJiti(): Promise<JitiInstance> {
	jitiPromise ??= createPiTestJiti();
	return jitiPromise;
}

export function gatewayExtensionPath(fileName: string): string {
	return join(homedir(), ".pi", "agent", "extensions", fileName);
}

export async function importPiExtension<T>(fileName: string): Promise<T> {
	const jiti = await getPiTestJiti();
	return (await jiti.import(gatewayExtensionPath(fileName), {
		default: true,
	})) as T;
}

export async function importPiExtensionModule<T>(fileName: string): Promise<T> {
	const jiti = await getPiTestJiti();
	return (await jiti.import(gatewayExtensionPath(fileName))) as T;
}
