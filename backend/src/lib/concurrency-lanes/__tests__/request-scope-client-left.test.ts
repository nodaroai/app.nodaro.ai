/**
 * When a request's lane scope (request-scope.ts) counts its client as gone.
 *
 * The scope's client signal (`RequestSlotState.signal`) ends a wait for a slot
 * still in progress when the client went away before the response finished.
 * It is judged once, when the raw response closes, from whether the response
 * finished first. "Finished" is the response's `finish` event, never its
 * `writableFinished` flag: a request made in-process (`fastify.inject`, which
 * every MCP tool uses to reach a route) emits `finish` and then `close`, but
 * leaves `writableFinished` false, so the flag would call every completed
 * injected request one whose client left.
 *
 * Each way a response can end is pinned twice: for a signal handed out during
 * the request, and for one first asked for after the close.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import http from "node:http"
import { Readable } from "node:stream"
import { installLaneRequestScope } from "../request-scope.js"
import { currentHoldScope, type RequestSlotState } from "../hold.js"

let app: FastifyInstance
let port: number
let seen: { state?: RequestSlotState; early?: AbortSignal }
let entered: { promise: Promise<void>; resolve: () => void }
let closed: { promise: Promise<void>; resolve: () => void }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/** What every route does first: keep the scope's slot state (and, when asked, read its signal now). */
function capture(req: FastifyRequest, reply: FastifyReply): void {
  seen.state = currentHoldScope()?.request
  if (req.headers["x-hand-out"] === "1") seen.early = seen.state?.signal
  reply.raw.once("close", () => setImmediate(() => closed.resolve()))
  entered.resolve()
}

const waitForClose = (reply: FastifyReply) => new Promise<void>((r) => reply.raw.once("close", () => r()))

beforeEach(async () => {
  seen = {}
  entered = deferred()
  closed = deferred()
  app = Fastify()
  installLaneRequestScope(app)
  app.addHook("preHandler", async (req) => {
    req.userId = "U"
  })
  app.get("/json", async (req, reply) => {
    capture(req, reply)
    return { ok: true }
  })
  app.get("/no-content", async (req, reply) => {
    capture(req, reply)
    return reply.code(204).send()
  })
  app.get("/not-modified", async (req, reply) => {
    capture(req, reply)
    return reply.code(304).send()
  })
  app.get("/hijack", async (req, reply) => {
    capture(req, reply)
    reply.hijack()
    reply.raw.writeHead(200, { "content-type": "text/plain" })
    reply.raw.end("hijacked")
  })
  // A stream the handler writes itself (how GET /mcp and every server-sent-events route answer).
  app.get("/hijacked-stream", async (req, reply) => {
    capture(req, reply)
    reply.hijack()
    reply.raw.writeHead(200, { "content-type": "text/event-stream" })
    reply.raw.write("data: first\n\n")
    await waitForClose(reply)
  })
  app.get("/throws", async (req, reply) => {
    capture(req, reply)
    throw new Error("the handler failed; the error answer is sent in full")
  })
  app.get("/until-gone", async (req, reply) => {
    capture(req, reply)
    await waitForClose(reply)
    return { late: true }
  })
  app.get("/stream", async (req, reply) => {
    capture(req, reply)
    const body = Readable.from((async function* () {
      yield "first"
      await waitForClose(reply)
      yield "never read"
    })())
    return reply.type("text/plain").send(body)
  })
  app.get("/stream-breaks", async (req, reply) => {
    capture(req, reply)
    const body = Readable.from((async function* () {
      yield "first"
      await new Promise((r) => setTimeout(r, 10))
      throw new Error("the body failed half way")
    })())
    return reply.type("text/plain").send(body)
  })
  await app.listen({ port: 0, host: "127.0.0.1" })
  port = (app.server.address() as { port: number }).port
})

afterEach(async () => {
  await app.close()
})

type Ending = "complete" | "leave-before-headers" | "leave-mid-body"

/** One request over a real connection, ended the way `ending` says. */
function overSocket(method: string, path: string, ending: Ending, handOut: boolean): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: handOut ? { "x-hand-out": "1" } : {} }, (res) => {
      if (ending === "leave-mid-body") {
        res.once("data", () => req.destroy())
        res.on("error", () => undefined)
        return
      }
      res.resume()
      res.on("end", () => resolve())
      res.on("error", () => resolve())
    })
    req.on("error", () => resolve())
    req.on("close", () => resolve())
    req.end()
    if (ending === "leave-before-headers") void entered.promise.then(() => req.destroy())
  })
}

const SOCKET_CASES: ReadonlyArray<[name: string, method: string, path: string, ending: Ending, left: boolean]> = [
  ["a JSON answer read in full", "GET", "/json", "complete", false],
  ["a HEAD answer", "HEAD", "/json", "complete", false],
  ["a 204 answer", "GET", "/no-content", "complete", false],
  ["a 304 answer", "GET", "/not-modified", "complete", false],
  ["a hijacked reply the handler ends", "GET", "/hijack", "complete", false],
  ["the error answer of a handler that threw", "GET", "/throws", "complete", false],
  ["a client that leaves before the headers", "GET", "/until-gone", "leave-before-headers", true],
  ["a client that leaves half way through a streamed body", "GET", "/stream", "leave-mid-body", true],
  ["a client that leaves a stream the handler writes on a hijacked reply", "GET", "/hijacked-stream", "leave-mid-body", true],
  // Not the client's doing, but the response never finished either: it reads as gone, as it always did.
  ["a streamed body that fails half way", "GET", "/stream-breaks", "complete", true],
]

const INJECT_CASES: ReadonlyArray<[name: string, method: "GET" | "HEAD", path: string]> = [
  ["a JSON answer", "GET", "/json"],
  ["a HEAD answer", "HEAD", "/json"],
  ["a 204 answer", "GET", "/no-content"],
  ["a hijacked reply the handler ends", "GET", "/hijack"],
  ["the error answer of a handler that threw", "GET", "/throws"],
]

describe("over a real connection", () => {
  it.each(SOCKET_CASES)("%s: a signal handed out during the request", async (_name, method, path, ending, left) => {
    await overSocket(method, path, ending, true)
    await closed.promise
    expect(seen.early).toBeDefined()
    expect(seen.early!.aborted).toBe(left)
    expect(seen.state!.signal).toBe(seen.early)
  })

  it.each(SOCKET_CASES)("%s: a signal first asked for after the close", async (_name, method, path, ending, left) => {
    await overSocket(method, path, ending, false)
    await closed.promise
    expect(seen.early).toBeUndefined()
    expect(seen.state!.signal!.aborted).toBe(left)
  })
})

describe("a completed injected request is not a client that left", () => {
  it.each(INJECT_CASES)("%s: a signal handed out during the request", async (_name, method, path) => {
    await app.inject({ method, url: path, headers: { "x-hand-out": "1" } })
    await closed.promise
    expect(seen.early).toBeDefined()
    expect(seen.early!.aborted).toBe(false)
  })

  it.each(INJECT_CASES)("%s: a signal first asked for after the close", async (_name, method, path) => {
    await app.inject({ method, url: path })
    await closed.promise
    expect(seen.state!.signal!.aborted).toBe(false)
  })
})
