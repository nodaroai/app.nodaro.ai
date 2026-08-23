import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import Fastify, { type FastifyInstance } from "fastify"
import { newSession, type McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { createMcpInvoker, type McpToolCallResult, type McpToolDef } from "../../invoke.js"

/**
 * Shared test helpers for MCP tool unit tests. In-process invocation lives in
 * `lib/mcp/invoke.ts` (product code — the Workflow Copilot calls tools the
 * same way); these are thin wrappers that keep the historical test signatures.
 */
export type ToolCallResult = McpToolCallResult
export type ListedTool = McpToolDef

export async function callTool(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<ToolCallResult> {
  return createMcpInvoker(server).callTool(name, args)
}

export async function listTools(server: McpServer): Promise<ListedTool[]> {
  return createMcpInvoker(server).listTools()
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
