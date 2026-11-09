// @test-watches backend/src/app.ts
/**
 * A voice-lock refusal reaches the client in the platform's envelope,
 * `{ error: { code: "voice_not_available", message } }` with a 400, on every
 * HTTP path — including the one where a route does not catch it:
 *
 *   - a plugin route that lets `tk.voices.assertAllowed`'s `PluginHttpError`
 *     propagate, which Fastify's default handler used to answer as
 *     `{ statusCode, error: "Bad Request", message }` (the code was lost, so
 *     the SDK read `internal_error`);
 *   - the lock's own `VoiceNotAvailableError` escaping a route, or handed to
 *     `sendInternalError`, which used to answer a 500.
 *
 * And nothing else changes: every other error answers byte for byte as
 * Fastify's default handler answered it before the refusal handler existed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))

import { insertAppReport } from "../app-reports.js"
import {
  registerErrorTelemetry,
  registerRefusalErrorHandler,
  sendInternalError,
  __flushHttpErrorTelemetry,
  __resetHttpErrorTelemetry,
} from "../http-errors.js"
import { PluginHttpError } from "../private-plugins/types.js"
import { voiceNotAvailableBody, VoiceNotAvailableError } from "../voice-policy.js"

const LOCKED = { error: { code: "voice_not_available", message: "The selected voice is not available on this deployment." } }

beforeEach(() => {
  vi.mocked(insertAppReport).mockClear()
  __resetHttpErrorTelemetry()
})

/** An app whose one route throws `make()`; with or without the refusal handler. */
async function appThrowing(make: () => unknown, withHandler: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  if (withHandler) registerRefusalErrorHandler(app)
  app.get("/throws", async () => {
    throw make()
  })
  app.post("/echo", async (req) => req.body)
  await app.ready()
  return app
}

async function answer(app: FastifyInstance, opts: { method?: "GET" | "POST"; url?: string; payload?: string; headers?: Record<string, string> } = {}) {
  const res = await app.inject({ method: opts.method ?? "GET", url: opts.url ?? "/throws", payload: opts.payload, headers: opts.headers })
  return { status: res.statusCode, type: res.headers["content-type"], body: res.body }
}

describe("a refusal that escapes a route", () => {
  it("a toolkit refusal is answered as itself — before the handler it lost its code", async () => {
    const refusal = () => new PluginHttpError(400, voiceNotAvailableBody(), new VoiceNotAvailableError("gender_not_allowed"))

    const before = await answer(await appThrowing(refusal, false))
    expect(before.status).toBe(400)
    expect(JSON.parse(before.body)).toEqual({ statusCode: 400, error: "Bad Request", message: LOCKED.error.message })

    const after = await answer(await appThrowing(refusal, true))
    expect(after.status).toBe(400)
    expect(after.type).toMatch(/^application\/json/)
    expect(JSON.parse(after.body)).toEqual(LOCKED)
  })

  it("every toolkit refusal keeps its own status and body (a job-policy block is a 422)", async () => {
    const blocked = { error: { code: "job_blocked", message: "Not allowed here." } }
    const after = await answer(await appThrowing(() => new PluginHttpError(422, blocked, new Error("policy")), true))
    expect(after.status).toBe(422)
    expect(JSON.parse(after.body)).toEqual(blocked)
  })

  it("the voice lock's own error is a 400 refusal with its own sentence, not a 500", async () => {
    const dub = "Dubbing is not available on this deployment."
    const before = await answer(await appThrowing(() => new VoiceNotAvailableError("gender_unknown", dub), false))
    expect(before.status).toBe(500)

    const after = await answer(await appThrowing(() => new VoiceNotAvailableError("gender_unknown", dub), true))
    expect(after.status).toBe(400)
    expect(JSON.parse(after.body)).toEqual({ error: { code: "voice_not_available", message: dub } })
  })

  it("is not reported as a server error", async () => {
    const app = Fastify({ logger: false })
    registerRefusalErrorHandler(app)
    registerErrorTelemetry(app)
    app.get("/throws", async () => {
      throw new VoiceNotAvailableError("gender_not_allowed")
    })
    await app.ready()

    expect((await answer(app)).status).toBe(400)
    await __flushHttpErrorTelemetry()
    expect(insertAppReport).not.toHaveBeenCalled()
  })
})

describe("every other error answers exactly as before", () => {
  const lookalikes: Array<[string, () => unknown]> = [
    ["a plain error (500)", () => new Error("boom")],
    ["an error with its own status and code", () => Object.assign(new Error("taken"), { statusCode: 409, code: "name_taken" })],
    ["a 503", () => Object.assign(new Error("later"), { statusCode: 503 })],
    // Named like a refusal but not shaped like one: never a client answer.
    ["a PluginHttpError-named 500", () => Object.assign(new Error("x"), { name: "PluginHttpError", statusCode: 500, body: LOCKED })],
    ["a PluginHttpError-named error without a coded body", () => Object.assign(new Error("x"), { name: "PluginHttpError", statusCode: 400, body: { error: "no" } })],
    ["a VoiceNotAvailableError-named error without the code", () => Object.assign(new Error("x"), { name: "VoiceNotAvailableError" })],
    ["a thrown string", () => "not an error"],
    ["a thrown plain object with a status", () => ({ statusCode: 418, message: "teapot" })],
  ]

  for (const [label, make] of lookalikes) {
    it(label, async () => {
      const before = await answer(await appThrowing(make, false))
      const after = await answer(await appThrowing(make, true))
      expect(after).toEqual(before)
    })
  }

  it("an unknown route's 404", async () => {
    const opts = { url: "/nowhere" }
    expect(await answer(await appThrowing(() => new Error("x"), true), opts)).toEqual(await answer(await appThrowing(() => new Error("x"), false), opts))
  })

  it("a body that is not JSON", async () => {
    const opts = { method: "POST" as const, url: "/echo", payload: "{not json", headers: { "content-type": "application/json" } }
    const before = await answer(await appThrowing(() => new Error("x"), false), opts)
    expect(before.status).toBe(400)
    expect(await answer(await appThrowing(() => new Error("x"), true), opts)).toEqual(before)
  })
})

describe("sendInternalError", () => {
  function sent(err: unknown) {
    const reply = {
      statusCode: 200,
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
    const error = vi.fn()
    const req = { log: { error, info: vi.fn() }, method: "POST", url: "/v1/x", headers: {} } as unknown as FastifyRequest
    sendInternalError(reply as unknown as FastifyReply, req, err, "Failed")
    return { status: reply.statusCode, body: reply.body, loggedAsError: error.mock.calls.length > 0 }
  }

  it("answers tk.voices.assertAllowed's refusal verbatim (a plugin route's passthrough)", () => {
    const refusal = new PluginHttpError(400, voiceNotAvailableBody(), new VoiceNotAvailableError("gender_not_allowed"))
    expect(sent(refusal)).toEqual({ status: 400, body: LOCKED, loggedAsError: false })
  })

  it("answers the voice lock's own error as the refusal, never a 500", () => {
    expect(sent(new VoiceNotAvailableError("gender_not_allowed"))).toEqual({ status: 400, body: LOCKED, loggedAsError: false })
  })
})

describe("app.ts", () => {
  it("registers the refusal handler before any plugin or route", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app.ts"), "utf8")
    const handler = src.indexOf("registerRefusalErrorHandler(app)")
    const firstRegister = src.indexOf("await app.register(")
    expect(handler).toBeGreaterThan(0)
    expect(firstRegister).toBeGreaterThan(0)
    expect(handler).toBeLessThan(firstRegister)
  })
})
