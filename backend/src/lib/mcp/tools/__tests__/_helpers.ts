import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import Fastify, { type FastifyInstance } from "fastify"
import { newSession, type McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"

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

/** Session with the generation-verb scope — the common case in verb tests. */
export function executeSession(): McpSession {
  return newSession({
    userId: "u1",
    scopes: ["workflows:execute"] as Scope[],
    clientName: "Claude",
  })
}

export interface StubResult {
  fastify: FastifyInstance
  received: { url?: string; body?: Record<string, unknown> }
}

/** Stub Fastify instance capturing the URL + body a verb handler dispatches. */
export function stubRoute(method: "POST" | "GET", url: string, response: object): StubResult {
  const fastify = Fastify()
  const received: { url?: string; body?: Record<string, unknown> } = {}
  if (method === "POST") {
    fastify.post(url, async (req) => {
      received.url = req.url
      received.body = req.body as Record<string, unknown>
      return response
    })
  } else {
    fastify.get(url, async (req) => {
      received.url = req.url
      return response
    })
  }
  return { fastify, received }
}
