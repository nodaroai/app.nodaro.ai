import { afterEach, describe, expect, it } from "vitest"
import { probeSessionId, probeSnapshot, sessionProbeEnabled } from "../session-probe.js"

describe("MCP session probe", () => {
  afterEach(() => {
    delete process.env.MCP_SESSION_PROBE
  })

  it("is off unless MCP_SESSION_PROBE is set", () => {
    expect(sessionProbeEnabled()).toBe(false)
    process.env.MCP_SESSION_PROBE = "true"
    expect(sessionProbeEnabled()).toBe(true)
  })

  it("issues a fresh id each time", () => {
    expect(probeSessionId()).not.toBe(probeSessionId())
  })

  it("logs the echoed session id, _meta and safe headers, never a credential or an argument value", () => {
    const snap = probeSnapshot(
      {
        "mcp-session-id": "abc",
        "user-agent": "claude-ai/1.0",
        authorization: "Bearer secret",
        cookie: "a=b",
        "x-api-key": "k",
        "x-conversation": ["c1", "c2"],
        "x-forwarded-for": "1.2.3.4",
        "cf-connecting-ip": "1.2.3.4",
      },
      {
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "generate_image",
          arguments: { prompt: "a private prompt", provider: "flux" },
          _meta: { progressToken: 7, "openai/session": "s-1", accessToken: "t" },
        },
      },
    )
    expect(snap).toEqual({
      method: "tools/call",
      tool: "generate_image",
      sessionId: "abc",
      meta: { progressToken: "7", "openai/session": "s-1" },
      headers: { "mcp-session-id": "abc", "user-agent": "claude-ai/1.0", "x-conversation": "c1, c2" },
      argumentNames: ["prompt", "provider"],
      clientInfo: undefined,
    })
    expect(JSON.stringify(snap)).not.toContain("a private prompt")
    expect(JSON.stringify(snap)).not.toContain("secret")
    expect(JSON.stringify(snap)).not.toContain("1.2.3.4")
  })

  it("reads the client's name and version on initialize", () => {
    const snap = probeSnapshot({}, { method: "initialize", params: { clientInfo: { name: "claude-ai", version: "0.1" } } })
    expect(snap.clientInfo).toEqual({ name: "claude-ai", version: "0.1" })
  })

  it("cuts long values", () => {
    const snap = probeSnapshot({ "user-agent": "x".repeat(500) }, {})
    expect((snap.headers as Record<string, string>)["user-agent"]!.length).toBeLessThan(200)
  })
})

describe("user_request probe", () => {
  afterEach(() => {
    delete process.env.MCP_SESSION_PROBE
    delete process.env.MCP_SESSION_PROBE_USERS
  })

  it("applies only to listed accounts, and only while the probe is on", async () => {
    const { userRequestProbeFor } = await import("../session-probe.js")
    process.env.MCP_SESSION_PROBE_USERS = "u1"
    expect(userRequestProbeFor("u1")).toBe(false)
    process.env.MCP_SESSION_PROBE = "true"
    expect(userRequestProbeFor("u1")).toBe(true)
    expect(userRequestProbeFor("u2")).toBe(false)
    expect(userRequestProbeFor(undefined)).toBe(false)
  })

  it("adds user_request to a tool, logs it, and never hands it to the tool", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js")
    const { z } = await import("zod")
    const { attachUserRequestProbe } = await import("../session-probe.js")
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")

    const server = new McpServer({ name: "t", version: "1" }, { capabilities: { tools: {} } })
    const logged: Array<Record<string, unknown>> = []
    attachUserRequestProbe(server, (obj) => logged.push(obj))
    let received: Record<string, unknown> | undefined
    server.registerTool("make", { inputSchema: { prompt: z.string() } }, async (args) => {
      received = args as Record<string, unknown>
      return { content: [{ type: "text", text: "ok" }] }
    })
    let noArgsCalled = false
    server.registerTool("ping", { description: "no args" }, async () => {
      noArgsCalled = true
      return { content: [{ type: "text", text: "pong" }] }
    })

    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(a)
    const client = new Client({ name: "c", version: "1" })
    await client.connect(b)

    const tools = await client.listTools()
    const make = tools.tools.find((t) => t.name === "make")!
    expect(Object.keys((make.inputSchema as { properties: object }).properties)).toContain("user_request")

    await client.callTool({ name: "make", arguments: { prompt: "a cat", user_request: "make me a cat picture" } })
    expect(received).toEqual({ prompt: "a cat" })
    expect(logged[0]).toEqual({ probe: { tool: "make", filled: true, userRequest: "make me a cat picture" } })

    await client.callTool({ name: "ping", arguments: { user_request: "ping it" } })
    expect(noArgsCalled).toBe(true)
    expect(logged[1]).toEqual({ probe: { tool: "ping", filled: true, userRequest: "ping it" } })
  })
})
