/**
 * /v1/image-to-image on FLUX Fill Pro under a deployment's model restriction
 * (decided 2026-11-12). FLUX Fill Pro has a model-catalog entry, so
 * `models.allow` names it like any other model: a list that leaves it out
 * refuses it with `model_not_available` at the credit guard's door, before the
 * credit check, the job row or the queue; a list that names it, and a
 * deployment with no restriction, run it as before.
 *
 * The real route and the real credit guard (Cloud edition). The credit check
 * itself (`ee/lib/credit-guard-impl.ts`) is replaced by spies, so a refusal is
 * proven to come before it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  creditCheck: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: h.insert, update: () => ({ eq: async () => ({ error: null }) }) })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => h.creditCheck,
  reserveCreditsForJobImpl: h.reserve,
  checkPayerCanAffordImpl: vi.fn(),
  blockPaygOnConsumerSurface: vi.fn(),
  isWebFreeModeCandidate: vi.fn(() => false),
}))

import { imageToImageRoutes } from "../image-to-image.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"

const USER = "00000000-0000-4000-8000-000000000001"
const BODY = { imageUrl: "https://cdn.example.com/src.png", prompt: "a red scarf", maskUrl: "https://cdn.example.com/mask.png", provider: "flux-fill" }
/** A model the deployment offers that is not FLUX Fill Pro. */
const OTHER = "gpt-image-2-6-flare-i2i"

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 33, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => imageToImageRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = () => app.inject({ method: "POST", url: "/v1/image-to-image", payload: BODY })

function expectNothingStarted(): void {
  expect(h.creditCheck).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.reserve).not.toHaveBeenCalled()
  expect(h.queueAdd).not.toHaveBeenCalled()
}

function expectRan(): void {
  expect(h.creditCheck).toHaveBeenCalledTimes(1)
  expect(h.reserve).toHaveBeenCalledTimes(1)
  expect(h.reserve.mock.calls[0]![3]).toBe("flux-fill")
  expect(h.queueAdd).toHaveBeenCalledTimes(1)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: "flux-fill", maskUrl: BODY.maskUrl })
}

describe("/v1/image-to-image on FLUX Fill Pro under models.allow", () => {
  it("an allow list that does not name it refuses it with model_not_available, before the credit check, the job row or the queue", async () => {
    setProfile({ models: { allow: [OTHER] } })
    const res = await run()
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "model_not_available", message: deniedModelRejectionMessage(["flux-fill"]) } })
    expectNothingStarted()
  })

  it("an allow list that names it runs it as before", async () => {
    setProfile({ models: { allow: [OTHER, "flux-fill"] } })
    const res = await run()
    expect(res.statusCode).toBe(200)
    expectRan()
  })

  it("a deployment that restricts nothing runs it as before", async () => {
    setProfile(null)
    const res = await run()
    expect(res.statusCode).toBe(200)
    expectRan()
  })

  it("an explicit deny refuses it too", async () => {
    setProfile({ models: { deny: ["flux-fill"] } })
    const res = await run()
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expectNothingStarted()
  })

  it("the allow list still lets the other models of the route run (the refusal is FLUX Fill Pro's alone)", async () => {
    setProfile({ models: { allow: [OTHER] } })
    const res = await app.inject({ method: "POST", url: "/v1/image-to-image", payload: { ...BODY, provider: OTHER } })
    expect(res.statusCode).toBe(200)
    expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: OTHER })
  })
})
