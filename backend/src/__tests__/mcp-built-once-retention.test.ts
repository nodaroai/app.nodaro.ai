/**
 * WITH `MCP_TOOLS_BUILT_ONCE` ON, A REQUEST HOLDS ITS SESSION, NOT A WHOLE SET OF TOOLS.
 *
 * Every `POST /mcp` used to build every MCP tool and its schemas (tens of MB)
 * for that one request, and an in-flight call (a `wait_for_job` waiting on a
 * job) held all of it until it answered. With the flag on, the tools are built
 * once per build shape and each request gets a small server of its own that
 * runs them for its session. This boots the whole app with the flag on and
 * checks, by weak references (the primary assertion) and by the heap (a loose
 * second check):
 *  - after many requests over keep-alive connections, every per-request server
 *    and session is collectable, and no more tool sets are alive than shapes
 *    were asked for (one here);
 *  - while many `wait_for_job` calls are in flight, one tool set is alive, and
 *    the heap grows by far less than one tool set per call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import { collectedWithin, forceGc, keepAliveConnection } from "../test/collect-garbage.js"

const TOKEN = `ndr_app_${"e".repeat(64)}`
const JOB_ID = "22222222-2222-4222-8222-222222222222"

const h = vi.hoisted(() => {
  vi.stubEnv("MCP_ENABLED", "true")
  vi.stubEnv("MCP_TOOLS_BUILT_ONCE", "true")
  const state = {
    /** Every MCP tool set built (shared builds, and any per-request one), held weakly. */
    toolSets: [] as WeakRef<object>[],
    /** Every server a request was answered by, held weakly. */
    requestServers: [] as WeakRef<object>[],
    sessions: [] as WeakRef<object>[],
    /** How many times a job was read (a wait polls it). */
    jobReads: 0,
    supabase: null as unknown,
  }
  /** A query chain that answers `row` (or nothing) whatever is asked of it. */
  function chain(row: unknown, onRead?: () => void): unknown {
    const answer = () => {
      onRead?.()
      return { data: row, error: null }
    }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => answer()
        return () => proxy
      },
    })
    return proxy
  }
  const now = new Date().toISOString()
  state.supabase = {
    from: (table: string) => {
      if (table === "developer_app_tokens") {
        return chain({
          id: "tok-1",
          authorization_id: "auth-1",
          expires_at: null,
          revoked_at: null,
          developer_app_authorizations: {
            id: "auth-1",
            app_id: "00000000-0000-4000-8000-0000000000a1",
            user_id: "00000000-0000-4000-8000-0000000000e1",
            scopes_granted: ["workflows:read", "workflows:write", "workflows:execute", "jobs:read", "assets:read", "assets:write", "credits:read", "apps:read"],
            revoked_at: null,
            monthly_spend_cap_credits: null,
            developer_apps: { kind: "dynamic_mcp", owner_user_id: null },
          },
        })
      }
      if (table === "developer_apps") return chain({ name: "Claude" })
      if (table === "jobs") {
        return chain(
          { id: "22222222-2222-4222-8222-222222222222", status: "processing", job_type: "generate-image", progress: 10, created_at: now, started_at: now, output_data: null },
          () => {
            state.jobReads++
          },
        )
      }
      return chain(null)
    },
    rpc: () => chain(null),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }
  return state
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))
vi.mock("@/lib/mcp/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/server.js")>()
  return {
    ...actual,
    createMcpServer: (...args: Parameters<typeof actual.createMcpServer>) => {
      const server = actual.createMcpServer(...args)
      h.toolSets.push(new WeakRef(server))
      return server
    },
    buildMcpServer: async (...args: Parameters<typeof actual.buildMcpServer>) => {
      const server = await actual.buildMcpServer(...args)
      h.toolSets.push(new WeakRef(server))
      return server
    },
  }
})
vi.mock("@/lib/mcp/fastify-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/fastify-adapter.js")>()
  return {
    ...actual,
    handleMcpRequest: async (server: Parameters<typeof actual.handleMcpRequest>[0], ...rest: [Parameters<typeof actual.handleMcpRequest>[1], Parameters<typeof actual.handleMcpRequest>[2]]) => {
      h.requestServers.push(new WeakRef(server as object))
      return actual.handleMcpRequest(server, ...rest)
    },
  }
})
vi.mock("@/lib/mcp/session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/session.js")>()
  return {
    ...actual,
    newSession: (...args: Parameters<typeof actual.newSession>) => {
      const session = actual.newSession(...args)
      h.sessions.push(new WeakRef(session))
      return session
    },
  }
})

let app: FastifyInstance
let port: number

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
}, 120_000)

afterAll(async () => {
  await app?.close()
  vi.unstubAllEnvs()
})

const mcpHeaders = { authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream" }
const rpc = (id: number, method: string, params: object = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params })
const alive = (refs: WeakRef<object>[]) => refs.filter((r) => r.deref() !== undefined).length

describe("MCP tools built once", () => {
  it("keeps no per-request server or session, and one tool set, after many requests on open connections", async () => {
    const connections = Array.from({ length: 4 }, () => keepAliveConnection(port))
    const bodies = [rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }), rpc(2, "tools/list"), rpc(3, "tools/call", { name: "ping", arguments: {} }), rpc(4, "resources/list")]
    for (let round = 0; round < 6; round++) {
      const answers = await Promise.all(connections.map((c, i) => c.request({ method: "POST", path: "/mcp", headers: mcpHeaders, body: bodies[(round + i) % bodies.length] })))
      for (const a of answers) expect(a.status).toBe(200)
    }
    expect(h.requestServers).toHaveLength(24)
    expect(h.sessions).toHaveLength(24)
    const requestServersGone = await collectedWithin(h.requestServers)
    const sessionsGone = await collectedWithin(h.sessions)
    const toolSets = alive(h.toolSets)
    for (const c of connections) c.close()
    expect({ requestServersGone, sessionsGone, toolSets }).toEqual({ requestServersGone: true, sessionsGone: true, toolSets: 1 })
  }, 60_000)

  it("holds one tool set while many wait_for_job calls are in flight", async () => {
    const IN_FLIGHT = 10
    forceGc()
    const before = process.memoryUsage().heapUsed
    const controller = new AbortController()
    const connections = Array.from({ length: IN_FLIGHT }, () => keepAliveConnection(port))
    const reads = h.jobReads
    const calls = connections.map((c, i) =>
      c
        .request({ method: "POST", path: "/mcp", headers: mcpHeaders, body: rpc(i, "tools/call", { name: "wait_for_job", arguments: { job_id: JOB_ID, timeout_s: 50 } }), signal: controller.signal })
        .catch(() => null),
    )
    // Every call has read its job at least twice: all of them are waiting.
    const deadline = Date.now() + 20_000
    while (h.jobReads - reads < IN_FLIGHT * 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    expect(h.jobReads - reads).toBeGreaterThanOrEqual(IN_FLIGHT * 3)
    forceGc()
    const heldMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    const toolSets = alive(h.toolSets)
    controller.abort()
    for (const c of connections) c.close()
    await Promise.all(calls)
    expect(toolSets).toBe(1)
    // Loose: one tool set per call would be tens of MB each.
    expect(heldMb).toBeLessThan(IN_FLIGHT * 3)
  }, 60_000)
})
