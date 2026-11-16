/**
 * The request-user scope (lib/request-user-scope.ts) answers "who is this
 * request" to code with no `req` in hand, and lets go of the request once its
 * response is over.
 *
 * What it must keep answering: inside the handler after the body was parsed, in
 * a reply the handler hijacks, in a streamed reply, and in work the handler
 * started that goes on after the response ended.
 *
 * After the response closed, two cases. When its reply was already sent (the
 * response ended, or the handler took it over), Fastify starts none of the
 * hooks before the handler, and not the handler, for it any more, and no later
 * hook writes the user, so nothing can change who it is: the answer is the
 * user it had at the close. When the client left before that, sign-in and the
 * other hooks may still run: the answer is the request as it stands for as long
 * as the request is alive (a client that left during sign-in gets the user
 * sign-in set later; a user taken off the request afterwards is gone from the
 * answer too), and the user it was last seen with once it is not.
 *
 * What it must not do: keep the request (or anything it reaches, such as the
 * MCP server a `/mcp` request built) alive after the response. A keep-alive
 * connection that stays open after its answer is what used to hold it: the
 * socket's async context kept the store, and the store WAS the request. So
 * did a pooled connection the request itself opened (to the database, to a
 * provider), which keeps the context it was opened in for as long as it is
 * pooled.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import http from "node:http"
import { Readable } from "node:stream"
import { registerRequestUserScope, currentRequestUserId } from "../request-user-scope.js"
import { collectedWithin, keepAliveConnection } from "../../test/collect-garbage.js"

let app: FastifyInstance
let port: number
/** A server the requests call out to, over one pooled keep-alive connection. */
let upstream: http.Server
let upstreamAgent: http.Agent
const refs: WeakRef<object>[] = []
const seen: Record<string, unknown> = {}
let afterResponse: Promise<void>
let afterResponseDone: () => void
let inSignIn: { promise: Promise<void>; resolve: () => void }
let handlerRan: { promise: Promise<void>; resolve: () => void }
let readNow: { promise: Promise<void>; resolve: () => void }
let askedLater: { promise: Promise<void>; resolve: () => void }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const closeOf = (raw: http.ServerResponse) => new Promise<void>((r) => raw.once("close", () => r()))

beforeEach(async () => {
  refs.length = 0
  for (const k of Object.keys(seen)) delete seen[k]
  afterResponse = new Promise((r) => (afterResponseDone = r))
  inSignIn = deferred()
  handlerRan = deferred()
  readNow = deferred()
  askedLater = deferred()
  upstream = http.createServer((_req, res) => res.end("ok"))
  // No idle timeout: the pooled connection the tests count must not close on a slow run.
  upstream.keepAliveTimeout = 0
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()))
  upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  app = Fastify()
  registerRequestUserScope(app)
  // A stand-in for the auth hook, which sets the user AFTER the scope opened.
  app.addHook("preHandler", async (req) => {
    req.userId = String(req.headers["x-user"] ?? "")
  })
  app.post("/json", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    return { seen: currentRequestUserId(), echoed: (req.body as { v: number }).v }
  })
  app.post("/hijack", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    reply.hijack()
    reply.raw.writeHead(200, { "content-type": "application/json" })
    reply.raw.end(JSON.stringify({ seen: currentRequestUserId() }))
  })
  app.get("/stream", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    async function* body() {
      yield "a"
      await new Promise((r) => setTimeout(r, 5))
      yield JSON.stringify({ seen: currentRequestUserId() })
    }
    return reply.type("text/plain").send(Readable.from(body()))
  })
  app.post("/after", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    const closed = new Promise<void>((r) => reply.raw.once("close", () => r()))
    // Work the handler starts and leaves running: it asks after the response is over.
    void (async () => {
      await closed
      await new Promise((r) => setTimeout(r, 5))
      seen.after = currentRequestUserId()
      afterResponseDone()
    })()
    return { ok: true }
  })
  app.post("/calls-out", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    // The pooled connection is opened here, inside the request, and stays pooled after it.
    const upstreamPort = (upstream.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: upstreamPort, path: "/", agent: upstreamAgent }, (res) => {
        res.resume()
        res.on("end", () => resolve())
      }).on("error", reject)
    })
    return { seen: currentRequestUserId() }
  })
  app.post("/after-collected", async (req, reply) => {
    refs.push(new WeakRef(req), new WeakRef(reply))
    const closed = closeOf(reply.raw)
    // Work left running that asks only once the request itself is gone.
    void (async () => {
      await closed
      await readNow.promise
      seen.afterCollected = currentRequestUserId()
      afterResponseDone()
    })()
    return { ok: true }
  })
  // The client leaves while sign-in is still being checked; sign-in then sets
  // the user, and the handler still runs.
  app.post("/signed-in-after-close", {
    preHandler: async (req, reply) => {
      inSignIn.resolve()
      await closeOf(reply.raw)
      await new Promise((r) => setImmediate(r))
      req.userId = "user-late"
    },
  }, async () => {
    seen.signedInAfterClose = currentRequestUserId()
    handlerRan.resolve()
    return { ok: true }
  })
  // The user is taken off the request after sign-in (as a key limited to some
  // workflows is, on a route anyone may call), the client having left between the two.
  app.post("/cleared-after-close", {
    preHandler: async (req, reply) => {
      inSignIn.resolve()
      await closeOf(reply.raw)
      await new Promise((r) => setImmediate(r))
      req.userId = undefined
    },
  }, async () => {
    seen.clearedAfterClose = currentRequestUserId()
    handlerRan.resolve()
    return { ok: true }
  })
  // Work the handler leaves running, which keeps the request alive and asks
  // after the close; the user is changed on the request in between. Nothing in
  // the app changes it then (only hooks before the handler do), but if
  // something did, the answer for a reply already sent is the one it had at its close.
  const askAfterAChange = (req: FastifyRequest, raw: http.ServerResponse) => {
    void (async () => {
      await closeOf(raw)
      await new Promise((r) => setImmediate(r))
      req.userId = "changed-after-the-close"
      seen.askedLater = currentRequestUserId()
      askedLater.resolve()
    })()
  }
  app.post("/ended-then-changed", async (req, reply) => {
    askAfterAChange(req, reply.raw)
    return { ok: true }
  })
  app.post("/hijacked-ended-then-changed", async (req, reply) => {
    askAfterAChange(req, reply.raw)
    reply.hijack()
    reply.raw.writeHead(200, { "content-type": "application/json" })
    reply.raw.end("{}")
  })
  // A stream the handler writes itself (as GET /mcp and server-sent events do), which the client leaves.
  app.get("/hijacked-stream-then-changed", async (req, reply) => {
    askAfterAChange(req, reply.raw)
    reply.hijack()
    reply.raw.writeHead(200, { "content-type": "text/event-stream" })
    reply.raw.write("data: first\n\n")
    await closeOf(reply.raw)
  })
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
})

/** A POST whose client leaves once the request is in its sign-in step. */
function leaveDuringSignIn(path: string, headers: Record<string, string>): void {
  const body = "{}"
  const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": String(body.length) } })
  req.on("error", () => undefined)
  req.end(body)
  void inSignIn.promise.then(() => req.destroy())
}

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

describe("who the request is", () => {
  it("is known in the handler after a JSON body was parsed", async () => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method: "POST", path: "/json", headers: { "x-user": "user-7" }, body: JSON.stringify({ v: 1 }) })
    c.close()
    expect(JSON.parse(res.body)).toEqual({ seen: "user-7", echoed: 1 })
  })

  it("is known in a reply the handler hijacks", async () => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method: "POST", path: "/hijack", headers: { "x-user": "user-8" }, body: "{}" })
    c.close()
    expect(JSON.parse(res.body)).toEqual({ seen: "user-8" })
  })

  it("is known while a streamed reply is produced", async () => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method: "GET", path: "/stream", headers: { "x-user": "user-9" } })
    c.close()
    expect(res.body).toBe(`a${JSON.stringify({ seen: "user-9" })}`)
  })

  it("is still known to work the handler started, once the response is over", async () => {
    const c = keepAliveConnection(port)
    await c.request({ method: "POST", path: "/after", headers: { "x-user": "user-10" }, body: "{}" })
    await afterResponse
    c.close()
    expect(seen.after).toBe("user-10")
  })

  it("is the user sign-in set after the client left, in a handler that runs after that", async () => {
    leaveDuringSignIn("/signed-in-after-close", {})
    await handlerRan.promise
    expect(seen.signedInAfterClose).toBe("user-late")
  })

  it("is the request as it stands when asked, a user taken off it after the client left included", async () => {
    leaveDuringSignIn("/cleared-after-close", { "x-user": "user-13" })
    await handlerRan.promise
    expect(seen.clearedAfterClose).toBeNull()
  })

  it("is the user the request had, for work that asks once the request itself is gone", async () => {
    const c = keepAliveConnection(port)
    await c.request({ method: "POST", path: "/after-collected", headers: { "x-user": "user-12" }, body: "{}" })
    expect(await collectedWithin(refs)).toBe(true)
    readNow.resolve()
    await afterResponse
    c.close()
    expect(seen.afterCollected).toBe("user-12")
  })

  it.each([
    ["a JSON answer over a connection", "socket", "POST", "/ended-then-changed"],
    ["a JSON answer made in-process", "inject", "POST", "/ended-then-changed"],
    ["a hijacked reply the handler ended", "socket", "POST", "/hijacked-ended-then-changed"],
    ["a hijacked stream the client left", "leave", "GET", "/hijacked-stream-then-changed"],
  ] as const)("after %s, is the user the request had at its close, even while the request is alive and changed later", async (_name, how, method, path) => {
    const headers = { "x-user": "user-14" }
    if (how === "inject") {
      await app.inject({ method, url: path, headers, payload: {} })
    } else if (how === "socket") {
      const c = keepAliveConnection(port)
      await c.request({ method, path, headers, body: "{}" })
      c.close()
    } else {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => res.once("data", () => req.destroy()))
      req.on("error", () => undefined)
      req.end()
    }
    await askedLater.promise
    expect(seen.askedLater).toBe("user-14")
  })

  it("is nobody outside a request", () => {
    expect(currentRequestUserId()).toBeNull()
  })
})

describe("once the response is over", () => {
  it.each([
    ["a JSON reply", "POST", "/json", JSON.stringify({ v: 2 })],
    ["a hijacked reply", "POST", "/hijack", "{}"],
    ["a streamed reply", "GET", "/stream", undefined],
    ["a reply whose handler left work running", "POST", "/after", "{}"],
    ["a reply whose handler opened a pooled connection of its own", "POST", "/calls-out", "{}"],
  ] as const)("%s: the request and its reply are released while the connection stays open", async (_name, method, path, body) => {
    const c = keepAliveConnection(port)
    const res = await c.request({ method, path, headers: { "x-user": "user-11" }, body })
    if (path === "/after") await afterResponse
    if (path === "/calls-out") {
      expect(JSON.parse(res.body)).toEqual({ seen: "user-11" })
      // Only the pooled connection the handler opened may stay: the request's own is closed first.
      c.close()
      await serverConnectionsClosed()
      expect(Object.values(upstreamAgent.freeSockets).flat()).toHaveLength(1)
    }
    expect(refs).toHaveLength(2)
    // Whatever connection is still open and idle here must not be what keeps them.
    expect(await collectedWithin(refs)).toBe(true)
    c.close()
  })
})
