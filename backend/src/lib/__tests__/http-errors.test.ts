import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import type { FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError, registerInternalErrorSanitizer } from "../http-errors.js"

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
  const req = { log: { error } } as unknown as FastifyRequest
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
