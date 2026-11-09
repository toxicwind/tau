import { untilAborted, withTimeout } from "@oh-my-pi/pi-utils";
import { MCPManager, type MCPManagerApi } from "../mcp/manager";
import type { MCPResourceReadResult } from "../mcp/types";
<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import type { InternalResource, InternalUrl, ProtocolHandler } …`
import type { InternalResource, InternalUrl, InternalWriteResult, ProtocolHandler, WriteContext } from "./types";
=======
import mcpDoc from "../prompts/internal-urls/mcp.md" with { type: "text" };
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, SchemeSpec } from "./types";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/internal-urls/mcp-protocol.ts' for per-hunk detail, 'weave check' to verify your resolution

export interface McpResourceReadOptions {
	/** Match advertised resource URIs only, never URI templates. */
	exact?: boolean;
	/**
	 * Cap, in ms, on waiting for still-connecting servers and their catalogs when no connected server
	 * advertises the URI. Omitted: wait until that work settles, however long its reconnects take.
	 */
	waitMs?: number;
	signal?: AbortSignal;
}

function getUriTemplateMatchScore(
	uri: string,
	uriTemplate: string,
): { literalChars: number; expressionCount: number } | undefined {
	const expressionPattern = /\{[^}]+\}/g;
	const literalSegments = uriTemplate.split(expressionPattern);
	const expressionCount = (uriTemplate.match(expressionPattern) ?? []).length;
	const pattern = literalSegments.map(segment => RegExp.escape(segment)).join("(.*?)");
	const regex = new RegExp(`^${pattern}$`);
	if (!regex.test(uri)) return undefined;
	const literalChars = literalSegments.reduce((total, segment) => total + segment.length, 0);
	return { literalChars, expressionCount };
}

function extractResourceUri(url: InternalUrl): string {
	const scheme = url.protocol.replace(/:$/, "").toLowerCase();
	if (scheme !== "mcp") {
		// Server-advertised native URI (hierarchical or opaque). Preserve the
		// input byte-for-byte: `resolveTargetServer` matches by exact string
		// equality, so e.g. `catalog://root/` must keep its trailing slash.
		return url.rawHref ?? url.href;
	}
	// Legacy `mcp://<resource-uri>` wrapper: reconstruct the wrapped URI and
	// elide a bare trailing `/` that URL parsing adds to host-only forms.
	const host = url.rawHost || url.hostname;
	const rawPathname = url.rawPathname ?? url.pathname;
	const hasPath = rawPathname && rawPathname !== "/";
	const uri = `${host}${hasPath ? rawPathname : ""}${url.search}${url.hash}`.trim();
	return uri;
}

function resolveTargetServer(mcpManager: MCPManagerApi, uri: string, exact: boolean): string | undefined {
	const servers = mcpManager.getConnectedServers();
	for (const name of servers) {
		const serverResources = mcpManager.getServerResources(name);
		if (serverResources?.resources.some(r => r.uri === uri)) {
			return name;
		}
	}
	if (exact) return undefined;

	let bestTemplateMatch:
		| {
				serverName: string;
				literalChars: number;
				expressionCount: number;
				serverIndex: number;
				templateIndex: number;
		  }
		| undefined;

	for (const [serverIndex, name] of servers.entries()) {
		const serverResources = mcpManager.getServerResources(name);
		if (!serverResources) continue;

		for (const [templateIndex, template] of serverResources.templates.entries()) {
			const match = getUriTemplateMatchScore(uri, template.uriTemplate);
			if (!match) continue;

			const isBetterMatch =
				!bestTemplateMatch ||
				match.literalChars > bestTemplateMatch.literalChars ||
				(match.literalChars === bestTemplateMatch.literalChars &&
					(match.expressionCount < bestTemplateMatch.expressionCount ||
						(match.expressionCount === bestTemplateMatch.expressionCount &&
							(serverIndex < bestTemplateMatch.serverIndex ||
								(serverIndex === bestTemplateMatch.serverIndex &&
									templateIndex < bestTemplateMatch.templateIndex)))));

			if (isBetterMatch) {
				bestTemplateMatch = {
					serverName: name,
					literalChars: match.literalChars,
					expressionCount: match.expressionCount,
					serverIndex,
					templateIndex,
				};
			}
		}
	}

	return bestTemplateMatch?.serverName;
}

function formatAvailableResources(mcpManager: MCPManagerApi): string {
	const available = mcpManager
		.getConnectedServers()
		.flatMap(name => {
			const serverResources = mcpManager.getServerResources(name);
			if (!serverResources) return [];
			const concrete = serverResources.resources.map(r => `  ${r.uri} (${name})`);
			const templates = serverResources.templates.map(t => `  ${t.uriTemplate} (${name}, template)`);
			return [...concrete, ...templates];
		})
		.join("\n");
	const tools = mcpManager
		.getTools()
		.map(t => `  mcp://${t.mcpServerName}/${t.mcpToolName} (or xd://${t.name}) — ${t.description.split("\n")[0]?.slice(0, 120) ?? ""}`)
		.join("\n");
	const parts: string[] = [];
	if (available) parts.push(`Resources:\n${available}`);
	if (tools) parts.push(`Tools (read mcp://<tool> for schema, write JSON args to mcp://<tool> or xd://<tool> to execute):\n${tools}`);
	return parts.join("\n\n") || "  (none)";
}

function findMatchingMcpTool(mcpManager: MCPManager, uri: string) {
	const cleaned = uri.replace(/^\/+|\/+$/g, "");
	for (const tool of mcpManager.getTools()) {
		if (
			tool.name === cleaned ||
			tool.mcpToolName === cleaned ||
			`${tool.mcpServerName}/${tool.mcpToolName}` === cleaned ||
			`${tool.mcpServerName}__${tool.mcpToolName}` === cleaned
		) {
			return tool;
		}
	}
	return undefined;
}

/** Load connected catalogs before waiting on unrelated servers; check again after pending connects settle. */
async function settleCatalogs(mcpManager: MCPManagerApi, uri: string, exact: boolean): Promise<void> {
	await Promise.allSettled(mcpManager.getConnectedServers().map(name => mcpManager.ensureServerResources(name)));
	if (resolveTargetServer(mcpManager, uri, exact)) return;
	await mcpManager.waitForPendingConnections();
	await Promise.allSettled(mcpManager.getConnectedServers().map(name => mcpManager.ensureServerResources(name)));
}

/**
 * Read the MCP resource `url` names (see {@link extractResourceUri}) from the connected server that
 * advertises it. Undefined when no server does after pending connects and catalog loads settle.
 * That wait includes timeout-triggered reconnect ladders and never ends for a server with
 * `timeout: 0`, so speculative callers pass `waitMs`; an aborted `signal` also ends it early
 * (the work itself stays in flight for the manager).
 */
export async function readMcpResource(
	mcpManager: MCPManagerApi,
	url: InternalUrl,
	options?: McpResourceReadOptions,
): Promise<InternalResource | undefined> {
	const { exact = false, waitMs, signal } = options ?? {};
	const uri = extractResourceUri(url);
	let targetServer = resolveTargetServer(mcpManager, uri, exact);
	if (!targetServer) {
		// A server may already be connected but have an unloaded catalog, while another is still
		// handshaking after the startup race. Check connected catalogs first so unrelated pending
		// work cannot delay an advertised resource; then wait for late servers and retry.
		const settling = settleCatalogs(mcpManager, uri, exact);
		// `settleCatalogs` never rejects, so the only rejection to swallow is the spent budget.
		await untilAborted(
			signal,
			waitMs === undefined ? settling : withTimeout(settling, waitMs, "MCP wait budget spent").catch(() => {}),
		);
		targetServer = resolveTargetServer(mcpManager, uri, exact);
	}
	if (!targetServer) return undefined;

	let result: MCPResourceReadResult | undefined;
	try {
		result = await mcpManager.readServerResource(targetServer, uri, { signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`MCP resource read error: ${message}`);
	}

	if (!result) {
		throw new Error(`Server "${targetServer}" returned no content for "${uri}".`);
	}

	const textParts: string[] = [];
	for (const item of result.contents) {
		if (item.text !== undefined && item.text !== null) {
			textParts.push(item.text);
		} else if (item.blob) {
			textParts.push(`[Binary content: ${item.mimeType ?? "unknown"}, base64 length ${item.blob.length}]`);
		}
	}

	const content = textParts.length > 0 ? textParts.join("\n---\n") : "(empty resource)";
	return {
		url: url.href,
		content,
		contentType: "text/plain",
		size: Buffer.byteLength(content, "utf-8"),
		notes: [`MCP server: ${targetServer}`],
	};
}

/** No connected MCP server advertises the requested resource URI. */
export class McpResourceNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpResourceNotFoundError";
	}
}

/**
 * Protocol handler for MCP resources.
 *
 * URL forms:
 * - mcp://<resource-uri> (e.g. mcp://test://notes, mcp://ibkr://portfolio/positions)
 * - A resource's native URI when its scheme has no TAU handler (e.g. ags://capabilities/current-host)
 */
export class McpProtocolHandler implements ProtocolHandler {
	readonly scheme = "mcp";
	readonly spec: SchemeSpec = { backing: "remote", selectors: "opaque", immutable: true };

	/**
	 * Always advertised: the system prompt is built before MCP discovery settles
	 * (`MCPManager.instance()` and its server set are populated asynchronously),
	 * so there is no reliable synchronous "has servers" signal at prompt time.
	 */
	promptDoc(): string {
		return mcpDoc.trim();
	}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const mcpManager = await MCPManager.load();
		if (!mcpManager) {
			throw new Error("No MCP manager available. MCP servers may not be configured.");
		}
<<<<<<< ours — scope `resolve` in class `McpProtocolHandler` (S+F, confidence: low)
// refused_by: container_member · collision: ``No MCP server has resource "${uri}".\n\nAvailable resources:\n…`

		const uri = extractResourceUri(url);
		if (!uri) {
			await mcpManager.waitForPendingConnections();
			const servers = mcpManager.getConnectedServers();
			const content = [
				`mcp:// ${servers.length} connected server(s): ${servers.join(", ") || "none"}`,
				"",
				formatAvailableResources(mcpManager),
			].join("\n");
			return {
				url: url.href,
				content,
				contentType: "text/plain",
				size: Buffer.byteLength(content, "utf-8"),
			};
		}
		let targetServer = resolveTargetServer(mcpManager, uri);
		if (!targetServer) {
			// A configured server may still be handshaking when discovery returned
			// (the `connectServers` startup race deliberately leaves slow servers in
			// flight). This one-shot read must observe the final attached state
			// rather than the mid-handshake snapshot, so wait for pending connects
			// before loading catalogs and retrying.
			await mcpManager.waitForPendingConnections();
			await Promise.allSettled(mcpManager.getConnectedServers().map(name => mcpManager.ensureServerResources(name)));
			targetServer = resolveTargetServer(mcpManager, uri);
		}
		if (!targetServer) {
			const matchedTool = findMatchingMcpTool(mcpManager, uri);
			if (matchedTool) {
				const doc = [
					`# ${matchedTool.mcpServerName}/${matchedTool.mcpToolName} (xd://${matchedTool.name})`,
					"",
					matchedTool.description,
					"",
					"## Input Schema",
					"```json",
					JSON.stringify(matchedTool.parameters, null, 2),
					"```",
					`Execute by writing JSON args to \`mcp://${matchedTool.mcpServerName}/${matchedTool.mcpToolName}\` or \`xd://${matchedTool.name}\`.`,
				].join("\n");
				return {
					url: url.href,
					content: doc,
					contentType: "text/markdown",
					size: Buffer.byteLength(doc, "utf-8"),
					notes: [`MCP server: ${matchedTool.mcpServerName}`],
				};
			}
			throw new Error(
				`No MCP server has resource or tool "${uri}".\n\nAvailable:\n${formatAvailableResources(mcpManager)}`,
			);
		}

		let result: MCPResourceReadResult | undefined;
		try {
			result = await mcpManager.readServerResource(targetServer, uri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`MCP resource read error: ${message}`);
		}

		if (!result) {
			throw new Error(`Server "${targetServer}" returned no content for "${uri}".`);
		}

		const textParts: string[] = [];
		for (const item of result.contents) {
			if (item.text !== undefined && item.text !== null) {
				textParts.push(item.text);
			} else if (item.blob) {
				textParts.push(`[Binary content: ${item.mimeType ?? "unknown"}, base64 length ${item.blob.length}]`);
			}
		}

		const content = textParts.length > 0 ? textParts.join("\n---\n") : "(empty resource)";
		return {
			url: url.href,
			content,
			contentType: "text/plain",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [`MCP server: ${targetServer}`],
		};
=======
		const resource = await readMcpResource(mcpManager, url, { signal: context?.signal });
		if (resource) return resource;
		throw new McpResourceNotFoundError(
			`No MCP server has resource "${extractResourceUri(url)}".\n\nAvailable resources:\n${formatAvailableResources(mcpManager)}`,
		);
>>>>>>> theirs — scope `resolve`
	}

	async write(url: InternalUrl, content: string, context?: WriteContext): Promise<InternalWriteResult | void> {
		const mcpManager = MCPManager.instance();
		if (!mcpManager) {
			throw new Error("No MCP manager available. MCP servers may not be configured.");
		}
		await mcpManager.waitForPendingConnections();
		const uri = extractResourceUri(url);
		const matchedTool = findMatchingMcpTool(mcpManager, uri);
		if (!matchedTool) {
			throw new Error(
				`No MCP tool matches "${uri}".\n\nAvailable:\n${formatAvailableResources(mcpManager)}`,
			);
		}
		if (context?.xd) {
			await context.xd.write(matchedTool.name, content);
			return;
		}
		const args = content.trim() ? (JSON.parse(content) as Record<string, unknown>) : {};
		const res = await matchedTool.execute("mcp-url-write", args, undefined, {} as never, context?.signal);
		const text = res.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map(c => c.text)
			.join("\n");
		return { text: text || "(ok)", isError: res.isError };
	}
}
