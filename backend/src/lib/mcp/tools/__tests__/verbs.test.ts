import { describe, it, expect } from "vitest"
import Fastify from "fastify"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerVerbs } from "../verbs.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"

/**
 * v1.29 dispatch table inspection — same trick as `__tests__/server.test.ts`.
 * Keeps tests in-process without standing up a transport pair.
 */
type ToolHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<{
  content: { type: string; text?: string }[]
  _meta?: Record<string, unknown>
  isError?: boolean
}>

async function callTool(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<{
  content: { type: string; text?: string }[]
  _meta?: Record<string, unknown>
  isError?: boolean
}> {
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

type ListToolsHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<{ tools: { name: string }[] }>

async function listTools(server: McpServer): Promise<{ name: string }[]> {
  const internal = (server as unknown as {
    server: { _requestHandlers: Map<string, ListToolsHandler> }
  }).server._requestHandlers
  const handler = internal.get("tools/list")
  if (!handler) throw new Error("tools/list handler not registered")
  const result = await handler({ method: "tools/list", params: {} }, {})
  return result.tools
}

function buildServer(): McpServer {
  return new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  )
}

describe("generate_image verb", () => {
  it("composes prompt + structured fields and calls /v1/generate-image", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/generate-image", async (req) => {
      received = req.body as Record<string, unknown>
      return { jobId: "j-123" }
    })

    const server = buildServer()
    const session = newSession({
      userId: "u1",
      scopes: ["workflows:execute"] as Scope[],
      clientName: "Claude",
    })
    registerVerbs({ server, session, fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "a knight",
      model: "nano-banana",
      structured: { mood: "epic" },
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.type).toBe("text")
    expect((result._meta as Record<string, unknown>)?.task_id).toBe("j-123")
    // Structured fields must have been composed onto the prompt by the bridge.
    expect(received?.prompt).toBe("a knight Mood: epic.")
    // mcp_client must reach the route so the job row carries the connector name.
    expect(received?.mcp_client).toBe("Claude")
    // userId from session must be sent in the body — the auth middleware
    // reads it after validating the internal-orchestrator-secret header.
    expect(received?.userId).toBe("u1")
  })

  it("returns isError when /v1/generate-image responds 400", async () => {
    const fastify = Fastify()
    fastify.post("/v1/generate-image", async (_req, reply) =>
      reply.status(400).send({ error: "bad" }),
    )

    const server = buildServer()
    const session = newSession({
      userId: "u1",
      scopes: ["workflows:execute"] as Scope[],
      clientName: "Claude",
    })
    registerVerbs({ server, session, fastify })

    const result = await callTool(server, "generate_image", { prompt: "test" })
    expect(result.isError).toBe(true)
  })

  it("does NOT register generate_image without workflows:execute scope", async () => {
    const fastify = Fastify()
    const server = buildServer()
    const session = newSession({
      userId: "u1",
      scopes: ["jobs:read"] as Scope[],
      clientName: "Claude",
    })
    registerVerbs({ server, session, fastify })

    // The SDK only wires the `tools/list` request handler after the first
    // `registerTool()` call (see `setToolRequestHandlers` lazy init). When no
    // verb registers — because the scope gate fails — the handler is absent;
    // that absence IS the assertion that the verb wasn't registered.
    const internal = (server as unknown as {
      server: { _requestHandlers: Map<string, unknown> }
    }).server._requestHandlers
    expect(internal.get("tools/list")).toBeUndefined()
  })
})
