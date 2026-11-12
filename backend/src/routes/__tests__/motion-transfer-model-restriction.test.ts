/**
 * /v1/motion-transfer on Wan Animate under a deployment's model restriction
 * (decided 2026-11-12). Wan Animate Move and Replace have model-catalog
 * entries, so `models.allow` names them like any other model: a list that
 * leaves one out refuses it with `model_not_available` at the credit guard's
 * door, before the credit check, the job row or the queue; a list that names
 * it, and a deployment with no restriction, run it as before. The Kling motion
 * models keep running under a list that names them.
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

import { motionTransferRoutes } from "../motion-transfer.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"

const USER = "00000000-0000-4000-8000-000000000001"
const BODY = { imageUrl: "https://cdn.example.com/character.png", videoUrl: "https://cdn.example.com/dance.mp4", prompt: "a person dancing" }
const WAN = ["wan-animate-move", "wan-animate-replace"] as const
/** The Kling motion models (Kling 2.6's option `kling` runs catalog `motion-transfer`). */
const KLING_MODELS = ["motion-transfer", "kling-3.0-motion"]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 451, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => motionTransferRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { ...BODY, ...body } })

function expectNothingStarted(): void {
  expect(h.creditCheck).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.reserve).not.toHaveBeenCalled()
  expect(h.queueAdd).not.toHaveBeenCalled()
}

function expectRan(provider: string, creditId: string, resolution: string): void {
  expect(h.creditCheck).toHaveBeenCalledTimes(1)
  expect(h.reserve).toHaveBeenCalledTimes(1)
  expect(h.reserve.mock.calls[0]![3]).toBe(creditId)
  expect(h.queueAdd).toHaveBeenCalledTimes(1)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider, resolution })
}

describe("/v1/motion-transfer on Wan Animate under models.allow", () => {
  for (const provider of WAN) {
    it(`${provider}: an allow list that does not name it refuses it with model_not_available, before the credit check, the job row or the queue`, async () => {
      setProfile({ models: { allow: KLING_MODELS } })
      const res = await run({ provider, resolution: "580p" })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: { code: "model_not_available", message: deniedModelRejectionMessage([provider]) } })
      expectNothingStarted()
    })

    it(`${provider}: an allow list that names it runs it as before`, async () => {
      setProfile({ models: { allow: [...KLING_MODELS, provider] } })
      const res = await run({ provider, resolution: "580p" })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ jobId: "job-1" })
      expectRan(provider, `${provider}:580p`, "580p")
    })

    it(`${provider}: a deployment that restricts nothing runs it as before`, async () => {
      const res = await run({ provider, resolution: "480p" })
      expect(res.statusCode).toBe(200)
      expectRan(provider, provider, "480p")
    })

    it(`${provider}: an explicit deny refuses it too`, async () => {
      setProfile({ models: { deny: [provider] } })
      const res = await run({ provider })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("model_not_available")
      expectNothingStarted()
    })

    it(`${provider}: a size it does not have runs, and is charged, as 720p, and the answer says so`, async () => {
      const res = await run({ provider, resolution: "1080p" })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ jobId: "job-1", adjustments: [{ field: "resolution", from: "1080p", to: "720p" }] })
      expectRan(provider, `${provider}:720p`, "720p")
    })
  }

  it("the allow list still lets the Kling motion models run, 1080p and all (the refusal is Wan Animate's alone)", async () => {
    setProfile({ models: { allow: KLING_MODELS } })
    const res = await run({ provider: "kling-3.0", resolution: "1080p" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expectRan("kling-3.0", "kling-3.0-motion:1080p:10s", "1080p")
  })

  it("an Admin → Availability models override saved before Wan Animate was listed withholds it", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => !(WAN as readonly string[]).includes(id))) })
    const res = await run({ provider: "wan-animate-replace" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
    expectNothingStarted()
  })
})
