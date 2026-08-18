import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import type { FastifyReply, FastifyRequest } from "fastify"

vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

import { insertAppReport } from "../app-reports.js"
import {
  sendInternalError,
  registerInternalErrorSanitizer,
  registerErrorTelemetry,
  __resetHttpErrorTelemetry,
} from "../http-errors.js"

beforeEach(() => {
  vi.mocked(insertAppReport).mockClear()
  __resetHttpErrorTelemetry()
})

function makeReply() {
  const reply = {
    statusCode: 200 as number,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    send(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return reply
}

function makeReq() {
  const error = vi.fn()
  const req = {
    log: { error },
    method: "POST",
    url: "/v1/things?secret=1",
    routeOptions: { url: "/v1/things" },
    headers: {},
    userId: "00000000-0000-4000-8000-000000000042",
  } as unknown as FastifyRequest
  return { req, error }
}

describe("sendInternalError", () => {
  it("responds 500 with the stable internal_error code and a generic default message", () => {
    const reply = makeReply()
    const { req } = makeReq()
    sendInternalError(reply as unknown as FastifyReply, req, new Error("boom"))
    expect(reply.statusCode).toBe(500)
    expect(reply.body).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    })
  })

  it("uses the caller-provided client message when given", () => {
    const reply = makeReply()
    const { req } = makeReq()
    sendInternalError(reply as unknown as FastifyReply, req, new Error("boom"), "Failed to create job")
    expect(reply.body).toEqual({
      error: { code: "internal_error", message: "Failed to create job" },
    })
  })

  it("NEVER leaks the raw error text into the response body (the whole point)", () => {
    const reply = makeReply()
    const { req } = makeReq()
    const secret = 'column "profiles.secret_hash" does not exist'
    sendInternalError(reply as unknown as FastifyReply, req, new Error(secret), "Failed to create job")
    expect(JSON.stringify(reply.body)).not.toContain("secret_hash")
    expect(JSON.stringify(reply.body)).not.toContain("does not exist")
  })

  it("sanitizes non-Error throws too (e.g. a raw string / Supabase error object)", () => {
    const reply = makeReply()
    const { req } = makeReq()
    sendInternalError(
      reply as unknown as FastifyReply,
      req,
      { code: "PGRST", message: "relation jobs does not exist" },
      "Failed to load executions",
    )
    expect(reply.body).toEqual({
      error: { code: "internal_error", message: "Failed to load executions" },
    })
    expect(JSON.stringify(reply.body)).not.toContain("relation jobs")
  })

  it("logs the real error server-side so operators/admins keep full detail", () => {
    const reply = makeReply()
    const { req, error } = makeReq()
    const raw = new Error("raw supabase detail")
    sendInternalError(reply as unknown as FastifyReply, req, raw, "Failed to create job")
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith({ err: raw }, "Failed to create job")
  })
})

describe("registerInternalErrorSanitizer (onSend net)", () => {
  async function buildTestApp() {
    const app = Fastify()
    registerInternalErrorSanitizer(app)

    // A route that FORGOT the helper and echoes a raw DB error verbatim.
    app.get("/leak", async (_req, reply) =>
      reply
        .status(500)
        .send({ error: { code: "internal_error", message: 'column "x" does not exist' } }),
    )
    // A route using the helper — marked, so its curated message must survive.
    app.get("/helper", async (req, reply) =>
      sendInternalError(reply, req, new Error("raw db detail"), "Failed to create job"),
    )
    // A 500 with a DIFFERENT code — must pass through untouched.
    app.get("/other500", async (_req, reply) =>
      reply
        .status(500)
        .send({ error: { code: "provider_down", message: "upstream 503 from KIE" } }),
    )
    // A structured non-500 error — untouched, extra fields intact.
    app.get("/402", async (_req, reply) =>
      reply.status(402).send({
        error: { code: "insufficient_credits", message: "need 5", required: 5, available: 1 },
      }),
    )
    // A healthy 200 — never touched.
    app.get("/ok", async (_req, reply) => reply.send({ ok: true }))

    await app.ready()
    return app
  }

  it("genericizes an unmarked internal_error 500 body — no raw leak on the wire", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/leak" })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    })
    expect(res.body).not.toContain("does not exist")
    // content-length must match the rewritten (shorter) body, not the original.
    expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(res.body))
    await app.close()
  })

  it("preserves the curated message from sendInternalError (marked reply)", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/helper" })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Failed to create job" },
    })
    expect(res.body).not.toContain("raw db detail")
    await app.close()
  })

  it("leaves other 500 error codes untouched", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/other500" })
    expect(res.json()).toEqual({
      error: { code: "provider_down", message: "upstream 503 from KIE" },
    })
    await app.close()
  })

  it("leaves structured non-500 errors untouched, including extra fields", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/402" })
    expect(res.statusCode).toBe(402)
    expect(res.json()).toEqual({
      error: { code: "insufficient_credits", message: "need 5", required: 5, available: 1 },
    })
    await app.close()
  })

  it("never touches non-error responses", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "GET", url: "/ok" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })
})

describe("server-error telemetry → app_reports", () => {
  /** Reporting goes through a lazy dynamic import — flush it before asserting. */
  const flushReports = () => vi.waitFor(() => expect(insertAppReport).toHaveBeenCalled())

  it("sendInternalError files an internal-error report with route, user, raw message and stack", async () => {
    const reply = makeReply()
    const { req } = makeReq()
    const err = new Error("relation jobs does not exist")
    sendInternalError(reply as unknown as FastifyReply, req, err, "Failed to create job")

    await flushReports()
    expect(insertAppReport).toHaveBeenCalledTimes(1)
    const report = vi.mocked(insertAppReport).mock.calls[0][0]
    expect(report.node).toBe("http-error-net")
    expect(report.kind).toBe("internal-error")
    expect(report.severity).toBe("error")
    expect(report.title).toBe("POST /v1/things — relation jobs does not exist")
    expect(report.userId).toBe("00000000-0000-4000-8000-000000000042")
    expect(report.payload).toMatchObject({
      method: "POST",
      route: "/v1/things",
      path: "/v1/things", // query string stripped
      via: "route-catch",
    })
    expect(String(report.payload?.stack)).toContain("relation jobs does not exist")
  })

  it("throttles repeats of the same (method, route, message) into one report", async () => {
    const reply = makeReply()
    const { req } = makeReq()
    sendInternalError(reply as unknown as FastifyReply, req, new Error("boom"))
    sendInternalError(reply as unknown as FastifyReply, req, new Error("boom"))
    await flushReports()
    expect(insertAppReport).toHaveBeenCalledTimes(1)

    sendInternalError(reply as unknown as FastifyReply, req, new Error("different failure"))
    await vi.waitFor(() => expect(insertAppReport).toHaveBeenCalledTimes(2))
  })

  it("registerErrorTelemetry reports UNCAUGHT route throws without altering the response", async () => {
    const app = Fastify()
    registerErrorTelemetry(app)
    app.get("/explodes", async () => {
      throw new Error("undefined is not a function")
    })
    await app.ready()

    const res = await app.inject({ method: "GET", url: "/explodes" })
    expect(res.statusCode).toBe(500)
    // Fastify's default 500 body stays exactly as it was — telemetry observes only.
    expect(res.body).not.toContain("app_reports")

    await flushReports()
    expect(insertAppReport).toHaveBeenCalledTimes(1)
    const report = vi.mocked(insertAppReport).mock.calls[0][0]
    expect(report.kind).toBe("internal-error")
    expect(report.payload).toMatchObject({ via: "uncaught", route: "/explodes", method: "GET" })
    expect(String(report.payload?.stack)).toContain("undefined is not a function")
    await app.close()
  })

  it("ignores 4xx errors (validation/auth are not server-error telemetry)", async () => {
    const app = Fastify()
    registerErrorTelemetry(app)
    app.get("/teapot", async () => {
      const err = new Error("short and stout") as Error & { statusCode: number }
      err.statusCode = 418
      throw err
    })
    await app.ready()

    const res = await app.inject({ method: "GET", url: "/teapot" })
    expect(res.statusCode).toBe(418)
    // Negative case: give the (would-be) async report a beat to land, then assert silence.
    await new Promise((resolve) => setImmediate(resolve))
    expect(insertAppReport).not.toHaveBeenCalled()
    await app.close()
  })

  it("the sanitizer net reports hand-composed internal_error 500s, but not marked (helper) replies twice", async () => {
    const app = Fastify()
    registerInternalErrorSanitizer(app)
    app.get("/leak", async (_req, reply) =>
      reply.status(500).send({ error: { code: "internal_error", message: 'column "x" does not exist' } }),
    )
    app.get("/helper", async (req, reply) =>
      sendInternalError(reply, req, new Error("raw db detail"), "Failed to create job"),
    )
    await app.ready()

    await app.inject({ method: "GET", url: "/leak" })
    await flushReports()
    expect(insertAppReport).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertAppReport).mock.calls[0][0].payload).toMatchObject({
      via: "sanitizer-net",
      message: 'column "x" does not exist',
    })

    await app.inject({ method: "GET", url: "/helper" })
    // exactly one MORE report — from sendInternalError, not a second from the net
    await vi.waitFor(() => expect(insertAppReport).toHaveBeenCalledTimes(2))
    expect(vi.mocked(insertAppReport).mock.calls[1][0].payload).toMatchObject({ via: "route-catch" })
    await app.close()
  })
})
