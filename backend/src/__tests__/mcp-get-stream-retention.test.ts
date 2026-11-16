/**
 * An open `GET /mcp` stream keeps no MCP server alive, because none is built
 * for it.
 *
 * MCP clients open a GET stream after they initialize and hold it for as long
 * as the connection lasts, reopening it whenever it closes. Nothing is ever
 * sent on it (the route is stateless: each POST builds its own server and
 * transport, and the server sends no notifications of its own), so a whole
 * MCP server (every tool and its schemas, tens of MB) built to answer the
 * GET stayed alive, unused, for the life of the stream: memory grew with the
 * number of connected clients.
 *
 * This boots the whole app (`buildApp`, every hook), opens a few streams on
 * real sockets, and requires that no server was built for them and that the
 * heap did not grow by anything near one server per stream while they are
 * open. The idle keep-alive case after a POST is idle-connection-retention.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import { forceGc } from "../test/collect-garbage.js"
import { openRaw, type OpenRaw } from "../routes/__tests__/helpers/raw-http.js"

const TOKEN = `ndr_${"e".repeat(64)}`

const h = vi.hoisted(() => {
  // The MCP route is served only where MCP is switched on (read once, when config loads).
  vi.stubEnv("MCP_ENABLED", "true")
  // Any query answers "nothing".
  function chain(): unknown {
    const answer = { data: null, error: null }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => answer
        return () => proxy
      },
    })
    return proxy
  }
  return {
    /** Every MCP server the route built, held weakly. */
    servers: [] as WeakRef<object>[],
    supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))
vi.mock("@/lib/api-token-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-token-resolver.js")>()),
  resolveApiToken: async (token: string) =>
    token === `ndr_${"e".repeat(64)}`
      ? { id: "t1", userId: "00000000-0000-4000-8000-0000000000e1", workflowIds: [], rateLimit: 600, tokenHash: "h", workspaceId: null }
      : null,
}))
vi.mock("@/lib/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/server.js")>()
  return {
    ...actual,
    buildMcpServer: async (...args: Parameters<typeof actual.buildMcpServer>) => {
      const server = await actual.buildMcpServer(...args)
      h.servers.push(new WeakRef(server))
      return server
    },
  }
})

const STREAMS = 20
/**
 * What a socket and its request may cost. Measured: about 40 KB per
 * open stream with no server built, and about 1.4 MB per stream when each
 * built one (in this test's configuration). Twenty streams keep the budget
 * (5 MB in all) far from both, so neither noise nor a small change trips it.
 */
const PER_STREAM_CEILING_BYTES = 256 * 1024
let app: FastifyInstance
let port: number

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
}, 120_000)

afterAll(async () => {
  app?.server.closeAllConnections()
  await app?.close()
  vi.unstubAllEnvs()
})

async function settledHeap(): Promise<number> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setImmediate(r))
    forceGc()
  }
  return process.memoryUsage().heapUsed
}

function openStream(): OpenRaw {
  return openRaw(port, { path: "/mcp", headers: [`Authorization: Bearer ${TOKEN}`, "Accept: text/event-stream"] })
}

describe("open GET /mcp streams", () => {
  it("keep no MCP server alive, and the heap does not grow by one per stream", async () => {
    // Warm every lazy path a stream takes (first-call imports, caches), so the
    // measured growth is the streams' own.
    const warm = openStream()
    expect((await warm.answer).status).toBe(200)
    warm.close()
    await new Promise((r) => setTimeout(r, 50))
    h.servers.length = 0

    const before = await settledHeap()
    const streams = Array.from({ length: STREAMS }, openStream)
    for (const s of streams) expect((await s.answer).status).toBe(200)
    const during = await settledHeap()
    const alive = h.servers.filter((s) => s.deref() !== undefined).length
    const built = h.servers.length
    for (const s of streams) s.close()

    const perStream = Math.round((during - before) / STREAMS)
    expect({ built, alive }).toEqual({ built: 0, alive: 0 })
    expect(perStream).toBeLessThan(PER_STREAM_CEILING_BYTES)
  }, 60_000)
})
