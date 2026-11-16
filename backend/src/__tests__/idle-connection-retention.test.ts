/**
 * An idle keep-alive connection keeps nothing of the requests it carried.
 *
 * Each `POST /mcp` builds a whole MCP server (every tool and its schemas,
 * tens of MB) for that one request. A connection that stays open after its
 * answer — the normal case behind a proxy that reuses its upstream
 * connections — used to keep that server alive until the connection closed:
 * the socket kept the async context of the request it served, and the request
 * scopes in that context (lib/request-user-scope.ts, the concurrency lanes'
 * request scope) reached the request, its reply, and through them the server.
 * Memory then grew with the number of open connections, not with work in
 * flight.
 *
 * This boots the whole app (`buildApp`, Cloud edition, every hook), sends one
 * `POST /mcp` on each of a few real keep-alive connections, leaves them open,
 * and requires every MCP server built to be collectable — and again after
 * each connection has also carried ordinary requests.
 *
 * The two cases guard two ways a finished request's context stays alive:
 *  - the request's own connection, left open and idle after its answer;
 *  - a pooled connection the request itself opened, as a database or provider
 *    client opens one inside the request. The database is a mock here, so each
 *    MCP request opens one such connection to a local server, and it stays
 *    pooled while the request's own connection carries ordinary requests
 *    (which, on their own, usually move that connection's context off the MCP
 *    request: without the pooled connection this case rarely failed before
 *    the fix).
 * The scope tests pin each path per scope (lib/__tests__/request-user-scope.test.ts,
 * lib/concurrency-lanes/__tests__/request-scope-release.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import http from "node:http"
import { collectedWithin, keepAliveConnection } from "../test/collect-garbage.js"

const TOKEN = `ndr_${"d".repeat(64)}`

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
    /**
     * When set, each MCP request first opens a keep-alive connection of its own
     * to this local server (its own pool, so the connection is opened inside
     * the request), and leaves it pooled.
     */
    callOutTo: null as null | { port: number; pools: import("node:http").Agent[] },
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
    token === `ndr_${"d".repeat(64)}`
      ? { id: "t1", userId: "00000000-0000-4000-8000-0000000000d1", workflowIds: [], rateLimit: 600, tokenHash: "h", workspaceId: null }
      : null,
}))
vi.mock("@/lib/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/server.js")>()
  return {
    ...actual,
    buildMcpServer: async (...args: Parameters<typeof actual.buildMcpServer>) => {
      const target = h.callOutTo
      if (target) {
        const { default: nodeHttp } = await import("node:http")
        const pool = new nodeHttp.Agent({ keepAlive: true, maxSockets: 1 })
        target.pools.push(pool)
        await new Promise<void>((resolve, reject) => {
          nodeHttp.get({ host: "127.0.0.1", port: target.port, path: "/", agent: pool }, (res) => {
            res.resume()
            res.on("end", () => resolve())
          }).on("error", reject)
        })
      }
      const server = await actual.buildMcpServer(...args)
      h.servers.push(new WeakRef(server))
      return server
    },
  }
})

const CONNECTIONS = 4
let app: FastifyInstance
let port: number
/** The local server the MCP requests call out to in the second case. */
let upstream: http.Server

beforeAll(async () => {
  upstream = http.createServer((_req, res) => res.end("ok"))
  // No idle timeout: the pooled connections the second case counts must not close on a slow run.
  upstream.keepAliveTimeout = 0
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()))
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
}, 120_000)

afterAll(async () => {
  for (const pool of h.callOutTo?.pools ?? []) pool.destroy()
  h.callOutTo = null
  await app?.close()
  await new Promise<void>((r) => upstream.close(() => r()))
  vi.unstubAllEnvs()
})

const openConnections = () => new Promise<number>((r) => app.server.getConnections((_err, n) => r(n)))

const toolsList = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
const mcpHeaders = { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" }

async function oneMcpRequestEach(count: number): Promise<Array<ReturnType<typeof keepAliveConnection>>> {
  const connections = Array.from({ length: count }, () => keepAliveConnection(port))
  const answers = await Promise.all(connections.map((c) => c.request({ method: "POST", path: "/mcp", headers: mcpHeaders, body: toolsList })))
  for (const a of answers) {
    expect(a.status).toBe(200)
    expect(JSON.parse(a.body).result.tools.length).toBeGreaterThan(0)
  }
  return connections
}

describe("an idle keep-alive connection after a POST /mcp", () => {
  it("keeps no MCP server alive", async () => {
    h.servers.length = 0
    const connections = await oneMcpRequestEach(CONNECTIONS)
    expect(h.servers).toHaveLength(CONNECTIONS)
    expect(await openConnections()).toBeGreaterThanOrEqual(CONNECTIONS)
    const collected = await collectedWithin(h.servers)
    const alive = h.servers.filter((s) => s.deref() !== undefined).length
    for (const c of connections) c.close()
    expect({ collected, alive }).toEqual({ collected: true, alive: 0 })
  }, 60_000)

  it("keeps none alive after it carried ordinary requests, while connections the MCP requests opened stay pooled", async () => {
    h.servers.length = 0
    h.callOutTo = { port: (upstream.address() as { port: number }).port, pools: [] }
    const connections = await oneMcpRequestEach(CONNECTIONS)
    const pools = h.callOutTo.pools
    h.callOutTo = null
    for (let i = 0; i < 3; i++) {
      await Promise.all(connections.map((c) => c.request({ method: "GET", path: "/v1/models" })))
    }
    expect(h.servers).toHaveLength(CONNECTIONS)
    expect(await openConnections()).toBeGreaterThanOrEqual(CONNECTIONS)
    expect(pools.map((p) => Object.values(p.freeSockets).flat().length)).toEqual(Array(CONNECTIONS).fill(1))
    const collected = await collectedWithin(h.servers)
    const alive = h.servers.filter((s) => s.deref() !== undefined).length
    for (const c of connections) c.close()
    for (const p of pools) p.destroy()
    expect({ collected, alive }).toEqual({ collected: true, alive: 0 })
  }, 60_000)
})

