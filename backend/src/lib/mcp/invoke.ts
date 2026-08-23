/**
 * In-process MCP tool invocation.
 *
 * The MCP server is normally driven over HTTP by an external client
 * (Claude.ai, Cursor, …). The in-app Workflow Copilot runs the model loop on
 * this backend and needs to list and call the SAME tools without a transport
 * round-trip. This is the one sanctioned way to do that — the test helper in
 * `tools/__tests__/_helpers.ts` re-exports it so tests and product code share
 * a single implementation.
 *
 * Primary path: the SDK keeps its `tools/list` / `tools/call` handlers on a
 * private `_requestHandlers` map; calling them directly skips all transport
 * work. Fallback (if an SDK upgrade hides the map): a linked in-memory
 * transport pair with a real `Client`, connected lazily and exactly once per
 * server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

export interface McpToolDef {
  name: string
  description?: string
  /** JSON Schema for the tool's arguments, as served by `tools/list`. */
  inputSchema: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface McpToolCallResult {
  content: { type: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
  isError?: boolean
}

export interface McpInvoker {
  listTools(): Promise<McpToolDef[]>
  callTool(name: string, args: unknown): Promise<McpToolCallResult>
  /** Tear down the fallback transport pair, if one was opened. Idempotent. */
  close(): Promise<void>
}

type RequestHandler<T> = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<T>

function privateHandlers(server: McpServer): Map<string, RequestHandler<unknown>> | null {
  const internal = (server as unknown as { server?: { _requestHandlers?: unknown } }).server
  const map = internal?._requestHandlers
  return map instanceof Map ? (map as Map<string, RequestHandler<unknown>>) : null
}

/**
 * Bind an invoker to a server. The fallback transport connects the server
 * exactly once per invoker and only when the private handler map is
 * unavailable — an already-connected server (e.g. one serving HTTP) cannot
 * be connected again, so pass an UNCONNECTED, per-request server here.
 */
export function createMcpInvoker(server: McpServer): McpInvoker {
  let clientPromise: Promise<Client> | null = null
  const client = (): Promise<Client> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await server.connect(serverTransport)
        const c = new Client({ name: "nodaro-in-process", version: "1.0.0" })
        await c.connect(clientTransport)
        return c
      })()
    }
    return clientPromise
  }

  return {
    async close() {
      if (!clientPromise) return
      const c = await clientPromise.catch(() => null)
      clientPromise = null
      await c?.close()
    },

    async listTools() {
      const handlers = privateHandlers(server)
      if (handlers) {
        // The SDK installs `tools/list` lazily on the first registerTool(): a
        // server with NO tools has no handler, and the honest answer is "none"
        // — the fallback transport would only turn that into a protocol error.
        const handler = handlers.get("tools/list") as RequestHandler<{ tools: McpToolDef[] }> | undefined
        if (!handler) return []
        const result = await handler({ method: "tools/list", params: {} }, {})
        return result.tools
      }
      const result = await (await client()).listTools()
      return result.tools as unknown as McpToolDef[]
    },

    async callTool(name, args) {
      const handlers = privateHandlers(server)
      if (handlers) {
        const handler = handlers.get("tools/call") as RequestHandler<McpToolCallResult> | undefined
        if (!handler) throw new Error("tools/call handler not registered")
        return await handler({ method: "tools/call", params: { name, arguments: args } }, {})
      }
      const result = await (await client()).callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      })
      return result as unknown as McpToolCallResult
    },
  }
}
