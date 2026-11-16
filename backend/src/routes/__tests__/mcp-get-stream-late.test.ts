import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * A `GET /mcp` that reaches its answer late: while sign-in is still checking
 * the token (an async preHandler waiting on I/O), its client leaves, or the
 * app starts closing. Fastify still runs the handler once the check returns,
 * so the answer must not open a stream nobody will ever end:
 *  - a client already gone: nothing is written, no timer is started, nothing
 *    is held, and the handler settles;
 *  - the app already closing: the stream head is answered as for any other
 *    GET, and the connection is cut right after it, as the app's close cuts
 *    every stream already open; the close does not wait on it.
 * The token check is held open here by a gate on the token lookup.
 */

const TOKEN = `ndr_${"7".repeat(64)}`

const h = vi.hoisted(() => {
  vi.stubEnv("MCP_ENABLED", "true")
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
    supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
    /** While set, the token lookup waits on it. */
    gate: null as null | Promise<void>,
    /** Token lookups that have started waiting on the gate. */
    waiting: 0,
    /** Each GET answer the route started: whether it has settled. */
    answers: [] as Array<{ settled: boolean }>,
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
  resolveApiToken: async (token: string) => {
    if (h.gate) {
      h.waiting++
      await h.gate
    }
    return token === `ndr_${"7".repeat(64)}`
      ? { id: "t7", userId: "00000000-0000-4000-8000-0000000000c7", workflowIds: [], rateLimit: 600, tokenHash: "h", workspaceId: null }
      : null
  },
}))
vi.mock("@/lib/mcp/get-stream.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/get-stream.js")>()
  return {
    ...actual,
    answerMcpGet: (...args: Parameters<typeof actual.answerMcpGet>) => {
      const answer = { settled: false }
      h.answers.push(answer)
      return actual.answerMcpGet(...args).finally(() => {
        answer.settled = true
      })
    },
  }
})

import { openMcpGetStreamCount } from "../../lib/mcp/get-stream.js"
import { openRaw } from "./helpers/raw-http.js"

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => {}
  const promise = new Promise<void>((r) => (open = r))
  return { promise, open }
}

describe("a GET /mcp whose answer comes late", () => {
  let app: FastifyInstance
  let port: number
  /** Every GET /mcp response, and whether it has closed (seen from the Node server, beside Fastify). */
  const responses: Array<{ res: ServerResponse; closed: boolean }> = []

  beforeAll(async () => {
    const { buildApp } = await import("@/app.js")
    app = await buildApp()
    await app.listen({ port: 0, host: "127.0.0.1" })
    port = (app.server.address() as { port: number }).port
    app.server.on("request", (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== "/mcp" || req.method !== "GET") return
      const seen = { res, closed: false }
      responses.push(seen)
      res.once("close", () => (seen.closed = true))
    })
  }, 120_000)

  afterAll(async () => {
    h.gate = null
    vi.useRealTimers()
    app?.server.closeAllConnections()
    await app?.close()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    h.gate = null
    h.waiting = 0
    vi.useRealTimers()
  })

  const openGet = () => openRaw(port, { path: "/mcp", headers: [`Authorization: Bearer ${TOKEN}`, "Accept: text/event-stream"] })

  it("its client left while the token was checked: nothing is held, and the handler settles", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const held = gate()
    h.gate = held.promise
    const before = { answers: h.answers.length, responses: responses.length }

    const stream = openGet()
    await until(() => h.waiting === 1, "the token check to start waiting")
    stream.close()
    await until(() => responses.length === before.responses + 1 && responses[before.responses]!.closed, "the server to see the client leave")

    held.open()
    await until(() => h.answers.length === before.answers + 1, "the route to answer")
    const answer = h.answers[before.answers]!
    await until(() => answer.settled, "the answer to settle", 1_000).catch(() => {})
    expect({ settled: answer.settled, timers: vi.getTimerCount(), open: openMcpGetStreamCount(app) }).toEqual({ settled: true, timers: 0, open: 0 })
  })

  // Last: it closes the app.
  it("the app started closing while the token was checked: the head, then the connection cut, and the close does not wait", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const held = gate()
    h.gate = held.promise
    const before = h.answers.length

    const stream = openGet()
    await until(() => h.waiting === 1, "the token check to start waiting")
    let closed = false
    const closing = app.close().then(() => (closed = true))
    await new Promise((r) => setTimeout(r, 50))
    expect(closed).toBe(false)

    held.open()
    const head = await stream.answer
    const outcome = await Promise.race([closing.then(() => "closed"), new Promise((r) => setTimeout(() => r("still waiting after 3 s"), 3_000))])
    expect(outcome).toBe("closed")
    expect(head.status).toBe(200)
    expect(head.headerLines.filter((l) => !l.startsWith("Date"))).toEqual([
      "cache-control: no-cache, no-transform",
      "connection: keep-alive",
      "content-type: text/event-stream",
      "Transfer-Encoding: chunked",
    ])
    await until(() => stream.socket.destroyed, "the client to see the connection cut")
    const answer = h.answers[before]!
    await until(() => answer.settled, "the answer to settle", 1_000).catch(() => {})
    expect({ settled: answer.settled, timers: vi.getTimerCount(), open: openMcpGetStreamCount(app) }).toEqual({ settled: true, timers: 0, open: 0 })
  }, 15_000)
})
