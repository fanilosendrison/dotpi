import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const GATEWAY_RUNTIME_PACKAGES = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@fanilosendrison/event-sink",
] as const;

const gatewayPackageAliases = Object.fromEntries(
	GATEWAY_RUNTIME_PACKAGES.map((packageName) => [
		packageName,
		fileURLToPath(import.meta.resolve(packageName)),
	]),
);

const jiti = createJiti(import.meta.url, {
	alias: gatewayPackageAliases,
	moduleCache: false,
});

export function gatewayExtensionPath(fileName: string): string {
	return join(homedir(), ".pi", "agent", "extensions", fileName);
}

export async function importAgentModule<T>(
	...pathSegments: string[]
): Promise<T> {
	return (await jiti.import(join(homedir(), ".agents", ...pathSegments))) as T;
}

export async function importPiExtension<T>(fileName: string): Promise<T> {
	return (await jiti.import(gatewayExtensionPath(fileName), {
		default: true,
	})) as T;
}

export async function importPiExtensionModule<T>(fileName: string): Promise<T> {
	return (await jiti.import(gatewayExtensionPath(fileName))) as T;
}
