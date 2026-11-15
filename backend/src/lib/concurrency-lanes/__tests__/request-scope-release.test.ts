/**
 * A request's lane scope (request-scope.ts) lets go of the request's reply once
 * the scope has ended, and its client signal keeps the meaning it always had.
 *
 * The scope is the AsyncLocalStorage store every handler runs under, so
 * whatever keeps the async context of a finished request (a keep-alive
 * connection that stays open after its answer, a timer the request started)
 * keeps the scope. The scope reaching the reply meant it also reached
 * everything the reply reaches: for `/mcp`, the whole MCP server the request
 * built. These pin that it no longer does.
 *
 * The signal (`RequestSlotState.signal`, read by a wait for a slot) after the
 * scope ended: a signal handed out before is the same object and keeps working
 * (it aborts when the client leaves before the response finished); one first
 * asked for afterwards is aborted exactly when the response closed before it
 * finished, and never otherwise. Every way a response can end is pinned in
 * request-scope-client-left.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import http from "node:http"
import { installLaneRequestScope } from "../request-scope.js"
import { currentHoldScope, type RequestSlotState } from "../hold.js"
import { collectedWithin, keepAliveConnection } from "../../../test/collect-garbage.js"

let app: FastifyInstance
let port: number
/** A server the requests call out to, over one pooled keep-alive connection. */
let upstream: http.Server
let upstreamAgent: http.Agent
const refs: WeakRef<object>[] = []
const seen: { state?: RequestSlotState; early?: AbortSignal; ended?: () => void } = {}
let handlerEntered: Promise<void>
let enteredDone: () => void
let scopeEnded: Promise<void>

beforeEach(async () => {
  refs.length = 0
  delete seen.state
  delete seen.early
  handlerEntered = new Promise((r) => (enteredDone = r))
  scopeEnded = new Promise((r) => (seen.ended = r))
  upstream = http.createServer((_req, res) => res.end("ok"))
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()))
  upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  app = Fastify()
  installLaneRequestScope(app)
  app.addHook("preHandler", async (req) => {
    req.userId = "U"
  })
  // The scope's own end comes after the response's close (onResponse / close).
  app.addHook("onResponse", async () => {
    setImmediate(() => seen.ended?.())
  })
  app.post("/work", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    seen.state = currentHoldScope()?.request
    return { ok: true }
  })
  app.post("/hand-out", async (req, reply) => {
    seen.state = currentHoldScope()?.request
    seen.early = seen.state?.signal
    enteredDone()
    // Until the client leaves.
    await new Promise<void>((r) => reply.raw.once("close", () => r()))
    setImmediate(() => seen.ended?.())
    return { late: true }
  })
  app.post("/until-gone", async (_req, reply) => {
    seen.state = currentHoldScope()?.request
    enteredDone()
    await new Promise<void>((r) => reply.raw.once("close", () => r()))
    setImmediate(() => seen.ended?.())
    return { late: true }
  })
  app.post("/calls-out", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    // Opened inside the request's scope, and pooled after it.
    const upstreamPort = (upstream.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: upstreamPort, path: "/", agent: upstreamAgent }, (res) => {
        res.resume()
        res.on("end", () => resolve())
      }).on("error", reject)
    })
    return { ok: true }
  })
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
})

async function serverConnectionsClosed(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const open = await new Promise<number>((r) => app.server.getConnections((_e, n) => r(n)))
    if (open === 0) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("the request's connection did not close")
}

afterEach(async () => {
  upstreamAgent.destroy()
  await app.close()
  await new Promise<void>((r) => upstream.close(() => r()))
})

describe("after the request's scope ended", () => {
  it("the scope no longer reaches the request's reply, even while its slot state is held", async () => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method: "POST", path: "/work", body: "{}" })
    expect(res.status).toBe(200)
    await scopeEnded
    // `seen.state` is the scope's slot state, held strongly here, as a wait or
    // a child request holds it: it must not be a path to the reply.
    expect(seen.state).toBeDefined()
    expect(refs).toHaveLength(2)
    expect(await collectedWithin(refs)).toBe(true)
    c.close()
  })

  it("a pooled connection the request opened does not keep the request or its reply", async () => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method: "POST", path: "/calls-out", body: "{}" })
    expect(res.status).toBe(200)
    await scopeEnded
    // Only the pooled connection may stay: the request's own connection is closed first.
    c.close()
    await serverConnectionsClosed()
    expect(Object.values(upstreamAgent.freeSockets).flat()).toHaveLength(1)
    expect(refs).toHaveLength(2)
    expect(await collectedWithin(refs)).toBe(true)
  })

  it("a signal first asked for afterwards is not aborted when the response finished", async () => {
    const c = keepAliveConnection(port)
    await c.request({ method: "POST", path: "/work", body: "{}" })
    await scopeEnded
    c.close()
    const signal = seen.state!.signal!
    expect(signal.aborted).toBe(false)
    // and it stays one signal: asking again answers the same object
    expect(seen.state!.signal).toBe(signal)
  })

  it("a signal first asked for afterwards is aborted when the client left before the response finished", async () => {
    const c = keepAliveConnection(port)
    const ac = new AbortController()
    const p = c.request({ method: "POST", path: "/until-gone", body: "{}", signal: ac.signal }).catch((e: unknown) => e)
    await handlerEntered
    ac.abort()
    await p
    await scopeEnded
    c.close()
    expect(seen.state!.signal!.aborted).toBe(true)
  })

  it("a signal handed out before keeps working: it aborts when the client leaves, and is the one the state answers", async () => {
    const c = keepAliveConnection(port)
    const ac = new AbortController()
    const p = c.request({ method: "POST", path: "/hand-out", body: "{}", signal: ac.signal }).catch((e: unknown) => e)
    await handlerEntered
    expect(seen.early!.aborted).toBe(false)
    ac.abort()
    await p
    await scopeEnded
    c.close()
    expect(seen.early!.aborted).toBe(true)
    expect(seen.state!.signal).toBe(seen.early)
  })
})
