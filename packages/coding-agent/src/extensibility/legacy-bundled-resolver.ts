import { LEGACY_PI_CONFIG } from "./legacy-pi-config";

/**
 * Resolve a legacy Pi virtual module specifier to the actual module.
 * Used by the legacy pi loader test to simulate the resolution path.
 */
export async function resolveVirtualModule(specifier: string): Promise<unknown> {
	const codingAgentKey = `${LEGACY_PI_CONFIG.bundledVirtualScheme}${LEGACY_PI_CONFIG.canonicalScope}/tau-coding-agent`;
	if (specifier === codingAgentKey) {
		// Import the legacy shim which is the root of the legacy pi exports
		return await import("./legacy-tau-coding-agent-shim.ts");
	}
	throw new Error(`Unknown virtual module specifier: ${specifier}`);
}
