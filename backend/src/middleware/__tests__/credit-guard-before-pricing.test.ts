/**
 * A route's own costly step (`CreditGuardOpts.beforePricing`: Nodaro Image
 * Upscale's input copy) runs past every cheaper gate of the guard — the model
 * deny, the app-token scope gate, a repeated Idempotency-Key — so a request
 * any of them answers never runs it; and before the price is resolved and
 * the balance checked (the cloud impl). In every edition. A step that answers
 * the request stops the guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

const mocks = vi.hoisted(() => ({
  credits: { value: true },
  findRecentMatchingJob: vi.fn(),
  impl: vi.fn(async () => undefined),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => mocks.credits.value,
  isCloud: () => mocks.credits.value,
  isCommunity: () => !mocks.credits.value,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: vi.fn() }))
vi.mock("@/lib/dedup-fingerprint.js", () => ({
  computeFingerprint: () => "fp-1",
  findRecentMatchingJob: mocks.findRecentMatchingJob,
  DEDUP_TTL_MS: 10_000,
  MIN_IDEMPOTENCY_KEY_LENGTH: 8,
}))
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => mocks.impl,
  reserveCreditsForJobImpl: vi.fn(),
}))

import { creditGuard } from "../credit-guard.js"

const USER = "00000000-0000-4000-8000-000000000001"
/** A repeated click's Idempotency-Key: plain words, no credential. */
const REPEATED_CLICK = "same-click-again"
const beforePricing = vi.fn(async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => undefined)
const resolver = vi.fn(() => "recraft-upscale")
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.credits.value = true
  mocks.findRecentMatchingJob.mockResolvedValue(null)
  beforePricing.mockImplementation(async () => undefined)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") {
      ;(req as { appAuthorization?: unknown }).appAuthorization = { appId: "app-1", authorizationId: "auth-1", scopes: scopes.split(",") }
    }
  })
  app.post("/v1/edit-image", { preHandler: creditGuard(resolver, { beforePricing }) }, async () => ({ ok: true }))
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/edit-image", payload: { provider: "recraft-upscale", imageUrl: "https://cdn.example/a.png", ...payload }, headers })

describe("creditGuard — beforePricing runs only past every cheaper gate", () => {
  it("an app token without a spending scope is refused before it runs", async () => {
    const res = await post({}, { "x-app-scopes": "jobs:read" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(beforePricing).not.toHaveBeenCalled()
  })

  it("a repeated Idempotency-Key answers the earlier job before it runs", async () => {
    mocks.findRecentMatchingJob.mockResolvedValueOnce({ id: "job-earlier" })
    const res = await post({}, { "idempotency-key": REPEATED_CLICK })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-earlier", deduped: true })
    expect(beforePricing).not.toHaveBeenCalled()
  })

  it("a model the deployment withholds is refused before it runs", async () => {
    // The shipped house model, served by no plugin here.
    const res = await post({ provider: "nodaro-image-upscale" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expect(beforePricing).not.toHaveBeenCalled()
  })

  it("a request every gate lets through runs it once, before the price and the balance", async () => {
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(beforePricing).toHaveBeenCalledTimes(1)
    expect(mocks.impl).toHaveBeenCalledTimes(1)
    expect(beforePricing.mock.invocationCallOrder[0]).toBeLessThan(mocks.impl.mock.invocationCallOrder[0]!)
  })

  it("a step that answers the request stops the guard: no price, no balance, no handler", async () => {
    beforePricing.mockImplementationOnce(async (_req, reply) => {
      await reply.status(400).send({ error: { code: "image_too_large", message: "too large" } })
    })
    const res = await post()
    expect(res.statusCode).toBe(400)
    expect(mocks.impl).not.toHaveBeenCalled()
  })

  it("runs where no credits are charged too (a deployment that serves the model without billing)", async () => {
    // The edition is read when the guard is built.
    mocks.credits.value = false
    const free = Fastify({ logger: false })
    free.addHook("preHandler", async (req) => {
      req.userId = USER
    })
    free.post("/v1/edit-image", { preHandler: creditGuard(resolver, { beforePricing }) }, async () => ({ ok: true }))
    await free.ready()
    try {
      const res = await free.inject({ method: "POST", url: "/v1/edit-image", payload: { provider: "recraft-upscale", imageUrl: "https://cdn.example/a.png" } })
      expect(res.statusCode).toBe(200)
      expect(beforePricing).toHaveBeenCalledTimes(1)
      expect(mocks.impl).not.toHaveBeenCalled()
    } finally {
      await free.close()
    }
  })
})
