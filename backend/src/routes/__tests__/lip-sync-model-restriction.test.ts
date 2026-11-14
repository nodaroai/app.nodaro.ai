/**
 * /v1/lip-sync on LatentSync, HeyGen Lipsync Precision and Lipsync 2 Pro under
 * a deployment's model restriction (decided 2026-11-12). The three have
 * model-catalog entries, so `models.allow` names them like any other model: a
 * list that leaves one out refuses it with `model_not_available` at the credit
 * guard's door, before the credit check, the job row or the queue; a list that
 * names it, and a deployment with no restriction, run it as before. The Kling
 * avatars keep running under a list that names them.
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
  /** Every download of the audio the route's measurement made. */
  downloads: 0,
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
// The balance check before the audio is measured (lib/lip-sync-floor-check.ts, its own test): the payer can afford it.
vi.mock("@/lib/lip-sync-floor-check.js", () => ({ lipSyncFloorRefusal: async () => undefined }))
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

// Lip Sync measures the audio of every model priced by its length before the
// guard (decided 2026-11-13): a 42 s file here (the 60 s bucket), read with no
// network.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadFile: async (_url: string, path: string) => {
    h.downloads++
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  measureDecodedAudio: async () => ({ overCap: false, samples: 42 * 44_100, seconds: 42 }),
}))

import { lipSyncRoutes } from "../lip-sync.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"

const USER = "00000000-0000-4000-8000-000000000001"
const BODY = { videoUrl: "https://cdn.example.com/face.mp4", audioUrl: "https://cdn.example.com/line.mp3" }
const LISTED = ["latentsync", "heygen-lipsync-precision", "lipsync-2-pro"] as const
/** The credit id each runs under with a 42-second line (the per-second ones bucket it to 60 s). */
const CREDIT_ID: Readonly<Record<(typeof LISTED)[number], string>> = {
  latentsync: "latentsync",
  "heygen-lipsync-precision": "heygen-lipsync-precision:60s",
  "lipsync-2-pro": "lipsync-2-pro:60s",
}
const KLING_AVATARS = ["kling-avatar", "kling-avatar-pro"]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.downloads = 0
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 2211, watermark: false })
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

const run = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/lip-sync", payload: { ...BODY, audioDurationSec: 42, ...body } })

function expectNothingStarted(): void {
  // The guard's model door answers before its measuring step: a withheld model's audio is never downloaded.
  expect(h.downloads).toBe(0)
  expect(h.creditCheck).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.reserve).not.toHaveBeenCalled()
  expect(h.queueAdd).not.toHaveBeenCalled()
}

function expectRan(provider: string, creditId: string): void {
  expect(h.creditCheck).toHaveBeenCalledTimes(1)
  expect(h.reserve).toHaveBeenCalledTimes(1)
  expect(h.reserve.mock.calls[0]![3]).toBe(creditId)
  expect(h.queueAdd).toHaveBeenCalledTimes(1)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider })
}

describe("/v1/lip-sync on LatentSync, HeyGen Lipsync Precision and Lipsync 2 Pro under models.allow", () => {
  for (const provider of LISTED) {
    it(`${provider}: an allow list that does not name it refuses it with model_not_available, before the credit check, the job row or the queue`, async () => {
      setProfile({ models: { allow: KLING_AVATARS } })
      const res = await run({ provider })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: { code: "model_not_available", message: deniedModelRejectionMessage([provider]) } })
      expectNothingStarted()
    })

    it(`${provider}: an allow list that names it runs it as before`, async () => {
      setProfile({ models: { allow: [...KLING_AVATARS, provider] } })
      const res = await run({ provider })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ jobId: "job-1" })
      expectRan(provider, CREDIT_ID[provider])
    })

    it(`${provider}: a deployment that restricts nothing runs it as before`, async () => {
      const res = await run({ provider })
      expect(res.statusCode).toBe(200)
      expectRan(provider, CREDIT_ID[provider])
    })

    it(`${provider}: an explicit deny refuses it too`, async () => {
      setProfile({ models: { deny: [provider] } })
      const res = await run({ provider })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("model_not_available")
      expectNothingStarted()
    })
  }

  it("the allow list still lets the Kling avatars run (the refusal is the unlisted model's alone)", async () => {
    setProfile({ models: { allow: KLING_AVATARS } })
    const res = await run({ provider: "kling-avatar-pro", imageUrl: "https://cdn.example.com/face.png" })
    expect(res.statusCode).toBe(200)
    expectRan("kling-avatar-pro", "kling-avatar-pro:60s")
  })

  it("an Admin → Availability models override saved before they were listed withholds them", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => !(LISTED as readonly string[]).includes(id))) })
    for (const provider of LISTED) {
      const res = await run({ provider })
      expect(res.statusCode, provider).toBe(403)
      expect(res.json().error.code, provider).toBe("model_not_available")
    }
    expectNothingStarted()
  })
})
