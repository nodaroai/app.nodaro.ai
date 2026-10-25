import { describe, expect, it } from "vitest"
import Fastify from "fastify"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { handleMcpRequest } from "../fastify-adapter.js"

function app() {
  const fastify = Fastify()
  fastify.post("/mcp", async (req, reply) => {
    const server = new McpServer({ name: "session-id-test", version: "1.0.0" }, { capabilities: { tools: {} } })
    server.registerTool("ping", { description: "ping" }, async () => ({ content: [{ type: "text", text: "pong" }] }))
    await handleMcpRequest(server, req, reply)
  })
  return fastify
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" }
const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "session-id", version: "0" } },
}

describe("handleMcpRequest session ids", () => {
  it("issues a session id on initialize, and a later request carrying it is still served statelessly", async () => {
    const a = app()
    const init = await a.inject({ method: "POST", url: "/mcp", headers: HEADERS, payload: INIT })
    expect(init.statusCode).toBe(200)
    const sessionId = init.headers["mcp-session-id"]
    expect(typeof sessionId).toBe("string")

    const list = await a.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...HEADERS, "mcp-session-id": sessionId as string },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    })
    expect(list.statusCode).toBe(200)
    expect(list.body).toContain("ping")
  })
})
