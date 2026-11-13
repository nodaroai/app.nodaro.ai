/**
 * Wav2Lip, VideoReTalking and SadTalker are retired from Lip Sync (decided
 * 2026-11-12). A /v1/lip-sync request that still names one is refused with one
 * sentence, `400 validation_error`, before the credit guard: no credit check,
 * no job row, no reservation, no queue. It is never moved to another model
 * (their inputs and prices differ). Whatever the deployment restricts, the
 * sentence is the retirement's. Every other option keeps running.
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

import { lipSyncRoutes } from "../lip-sync.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { LIP_SYNC_PROVIDERS, RETIRED_LIP_SYNC_PROVIDERS, retiredLipSyncProviderMessage } from "@nodaro/shared/models"

const USER = "00000000-0000-4000-8000-000000000001"
const BODY = {
  imageUrl: "https://cdn.example.com/face.png",
  videoUrl: "https://cdn.example.com/face.mp4",
  audioUrl: "https://cdn.example.com/line.mp3",
}
const RETIRED = Object.keys(RETIRED_LIP_SYNC_PROVIDERS)

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 8, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => lipSyncRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...BODY, ...body } })

function expectNothingStarted(): void {
  expect(h.creditCheck).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.reserve).not.toHaveBeenCalled()
  expect(h.queueAdd).not.toHaveBeenCalled()
}

describe("/v1/lip-sync refuses a retired Lip Sync model", () => {
  it("retires exactly Wav2Lip, VideoReTalking and SadTalker, none of them still offered", () => {
    expect(RETIRED.sort()).toEqual(["sadtalker", "video-retalking", "wav2lip"])
    for (const id of RETIRED) expect(LIP_SYNC_PROVIDERS as readonly string[]).not.toContain(id)
  })

  for (const provider of RETIRED) {
    it(`${provider}: 400 with the retirement's sentence, before the credit check, the job row, the reservation or the queue`, async () => {
      const res = await run({ provider, audioDurationSec: 12 })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: { code: "validation_error", message: retiredLipSyncProviderMessage(provider) } })
      expect(res.json().error.message).toBe(`${RETIRED_LIP_SYNC_PROVIDERS[provider]} is no longer available for Lip Sync. Pick another Lip Sync model.`)
      expectNothingStarted()
    })

    it(`${provider}: the same sentence on a deployment that restricts models (the retirement answers first)`, async () => {
      setProfile({ models: { allow: ["kling-avatar"] } })
      const res = await run({ provider })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toBe(retiredLipSyncProviderMessage(provider))
      expectNothingStarted()
    })
  }

  it("a value that only shares a name with an inherited property is not a retired model", async () => {
    const res = await run({ provider: "constructor" })
    expect(res.statusCode).not.toBe(200)
    expect(JSON.stringify(res.json())).not.toContain("no longer available for Lip Sync")
  })

  it("every option still offered runs (one per kind: a KIE avatar, a listed Replicate model)", async () => {
    for (const provider of ["kling-avatar", "latentsync"]) {
      vi.clearAllMocks()
      h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
      h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 8, watermark: false })
      const res = await run({ provider })
      expect(res.statusCode, provider).toBe(200)
      expect(h.queueAdd.mock.calls[0]![1], provider).toMatchObject({ provider })
    }
  })
})
