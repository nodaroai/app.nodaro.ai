import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

/**
 * Shared test helpers for MCP tool unit tests. The MCP SDK's tools/* handlers
 * live on a private `_requestHandlers` Map; we invoke them directly to avoid
 * the overhead of standing up a transport pair. Mirrors the trick used in
 * `__tests__/server.test.ts` and `__tests__/verbs.test.ts`.
 */
export interface ToolCallResult {
  content: { type: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

export type ToolHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<ToolCallResult>

export type ListToolsHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<{ tools: { name: string }[] }>

export async function callTool(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<ToolCallResult> {
  const internal = (server as unknown as {
    server: { _requestHandlers: Map<string, ToolHandler> }
  }).server._requestHandlers
  const handler = internal.get("tools/call")
  if (!handler) throw new Error("tools/call handler not registered")
  return await handler(
    { method: "tools/call", params: { name, arguments: args } },
    {},
  )
}

export async function listTools(server: McpServer): Promise<{ name: string }[]> {
  const internal = (server as unknown as {
    server: { _requestHandlers: Map<string, ListToolsHandler> }
  }).server._requestHandlers
  const handler = internal.get("tools/list")
  if (!handler) {
    // No tool registered yet — surface as empty list so callers can assert
    // "tool absent" without juggling undefined.
    return []
  }
  const result = await handler({ method: "tools/list", params: {} }, {})
  return result.tools
}

export function buildServer(): McpServer {
  return new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  )
}
