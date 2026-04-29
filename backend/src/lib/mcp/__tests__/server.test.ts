import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { type Scope } from "../../scopes.js"

// The dynamic tool factory queries published_apps; stub supabase so the
// (per-user) lookup returns no rows in this skeleton-level test.
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

const { buildMcpServer } = await import("../server.js")

/**
 * The SDK's tools/list handler is registered on the underlying `Server` instance
 * (`McpServer.server`). The Server's `_requestHandlers` Map is the dispatch table —
 * we read it to invoke the handler in-process without standing up a transport pair.
 *
 * If a future SDK rev hides this internal we'll switch to an InMemory transport pair,
 * but in v1.29 the Map is still the canonical, lowest-overhead inspection point.
 */
type ToolsListHandler = (
  req: { method: string; params: Record<string, unknown> },
  extra: Record<string, unknown>,
) => Promise<{ tools: { name: string }[] }>

async function listToolsOnServer(
  server: Awaited<ReturnType<typeof buildMcpServer>>,
): Promise<{ name: string }[]> {
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, ToolsListHandler> }
  }).server
  const handler = inner._requestHandlers.get("tools/list")
  if (!handler) throw new Error("tools/list handler not registered")
  const result = await handler({ method: "tools/list", params: {} }, {})
  return result.tools
}

describe("buildMcpServer skeleton", () => {
  it("registers a 'ping' placeholder tool", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "user-1",
      scopes: ["jobs:read"] as Scope[],
      clientName: "Test",
      fastify,
    })
    const tools = await listToolsOnServer(server)
    const names = tools.map((t) => t.name)
    expect(names).toContain("ping")
  })

  it("registers ping even when no scopes are granted (gate is empty)", async () => {
    const fastify = Fastify()
    const server = await buildMcpServer({
      userId: "user-1",
      scopes: [] as Scope[],
      clientName: "Test",
      fastify,
    })
    const tools = await listToolsOnServer(server)
    expect(tools.map((t) => t.name)).toContain("ping")
  })
})
