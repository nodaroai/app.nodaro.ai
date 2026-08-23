/**
 * In-process MCP invocation (`lib/mcp/invoke.ts`) — the seam the Workflow
 * Copilot uses to list and call tools without a transport.
 */
import { describe, expect, it } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { createMcpInvoker } from "../invoke.js"

function serverWithEcho(): McpServer {
  const server = new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  )
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "echoes its input",
      inputSchema: { text: z.string().describe("what to echo") },
    },
    async (args: { text: string }) => ({ content: [{ type: "text" as const, text: `echo:${args.text}` }] }),
  )
  return server
}

describe("createMcpInvoker", () => {
  it("lists registered tools with their JSON-schema input shape", async () => {
    const tools = await createMcpInvoker(serverWithEcho()).listTools()
    const echo = tools.find((t) => t.name === "echo")
    expect(echo).toBeDefined()
    expect(echo!.description).toBe("echoes its input")
    const schema = echo!.inputSchema as { type?: string; properties?: Record<string, unknown> }
    expect(schema.type).toBe("object")
    expect(Object.keys(schema.properties ?? {})).toEqual(["text"])
  })

  it("calls a tool and returns its content", async () => {
    const result = await createMcpInvoker(serverWithEcho()).callTool("echo", { text: "hi" })
    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toBe("echo:hi")
  })

  it("surfaces a missing tool as an error result, not a throw", async () => {
    const invoker = createMcpInvoker(serverWithEcho())
    const result = await invoker.callTool("nope", {}).catch((err: Error) => ({ thrown: err.message }))
    // The SDK reports unknown tools either as an isError result or as a
    // thrown McpError depending on version — both are acceptable, neither is
    // a silent success.
    if ("thrown" in result) expect(result.thrown).toMatch(/nope|not found/i)
    else expect(result.isError).toBe(true)
  })

  it("returns [] for a server with no tools without opening a transport", async () => {
    const bare = new McpServer({ name: "bare", version: "1.0.0" }, { capabilities: { tools: { listChanged: false } } })
    let connected = 0
    const original = bare.connect.bind(bare)
    bare.connect = async (t) => { connected += 1; return original(t) }
    expect(await createMcpInvoker(bare).listTools()).toEqual([])
    expect(connected).toBe(0)
  })

  it("falls back to an in-memory transport when the private handler map is unavailable", async () => {
    // A facade whose `.server` exposes no `_requestHandlers` (an SDK that hid
    // the map) but whose `connect` reaches the real server — so ONLY the
    // transport path can serve the call. The direct path sees nothing.
    const real = serverWithEcho()
    let connected = 0
    const facade = {
      connect: async (t: unknown) => { connected += 1; return (real as unknown as { connect: (x: unknown) => Promise<void> }).connect(t) },
      server: {},
    } as unknown as McpServer
    const invoker = createMcpInvoker(facade)
    const result = await invoker.callTool("echo", { text: "via-transport" })
    expect(result.content[0]?.text).toBe("echo:via-transport")
    const tools = await invoker.listTools()
    expect(tools.map((t) => t.name)).toContain("echo")
    // Connected exactly once for both calls, and close() tears it down.
    expect(connected).toBe(1)
    await invoker.close()
    await invoker.close()
  })
})
