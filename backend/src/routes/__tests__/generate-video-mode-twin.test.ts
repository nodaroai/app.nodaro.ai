import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"
import { VIDEO_MODE_ALIASES } from "@nodaro/shared/models"

/**
 * /v1/generate-video is the image-to-video lane. A model with one id per mode
 * (`VIDEO_MODE_ALIASES`) named by its text-to-video id (`grok`) used to pass
 * the route's schema, have its credits held, and fail in the worker, where no
 * image-to-video provider runs that id. The route now runs it as the model's
 * image-to-video id (`grok-i2v`) from its first pre-check on, so the credit
 * guard prices that id, and the job and the queue carry it. A prompt-only
 * request is still refused before anything is held. The real credit guard
 * runs; only the database, the reservation RPC and the queue are stubbed.
 */

vi.mock("../../lib/config.js", () => ({
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  isCloud: () => true,
  hasAdmin: () => true,
}))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })),
}))
vi.mock("../../lib/url-validator.js", () => ({ safeUrlSchema: z.string().url() }))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 1000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

const { jobInsert, jobUpsert, queueAdd, reserveSpy } = vi.hoisted(() => ({
  jobInsert: vi.fn((_row: Record<string, unknown>) => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }),
  })),
  jobUpsert: vi.fn((_row: Record<string, unknown>) => ({
    select: () => Promise.resolve({ data: [{ id: "job-1" }], error: null }),
  })),
  queueAdd: vi.fn((_name: string, _payload: Record<string, unknown>, _opts?: unknown) => Promise.resolve({ id: "queue-1" })),
  reserveSpy: vi.fn((..._args: unknown[]) => Promise.resolve({ usageLogId: "log-1", creditsReserved: 19, watermark: false })),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") {
        return { insert: jobInsert, upsert: jobUpsert, update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { credit_cost: 19, is_enabled: true, tier_restriction: null }, error: null }) }) }) }
      }
      return {}
    }),
  },
}))

vi.mock("../../ee/billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/credits.js")>("../../ee/billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
      reserveCredits: reserveSpy,
    },
  }
})
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: queueAdd } }))

const START = "https://r2.example.com/start.png"
const REF = "https://r2.example.com/ref-1.png"

beforeEach(() => { vi.clearAllMocks() })

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "u-1"
    ;(req as unknown as { isAppRun: boolean }).isAppRun = false
  })
  const { generateVideoRoutes } = await import("../generate-video.js")
  const { textToVideoRoutes } = await import("../text-to-video.js")
  await generateVideoRoutes(app)
  await textToVideoRoutes(app)
  return app
}

/** One request; what was reserved, recorded and queued. */
async function send(payload: Record<string, unknown>, url = "/v1/generate-video") {
  const app = await buildApp()
  const res = await app.inject({ method: "POST", url, payload: { prompt: "the waves roll in", ...payload } })
  await app.close()
  const row = (jobInsert.mock.calls[0]?.[0] ?? jobUpsert.mock.calls[0]?.[0]) as { input_data?: Record<string, unknown> } | undefined
  return {
    res,
    reservedOn: reserveSpy.mock.calls[0]?.[2] as string | undefined,
    recorded: row?.input_data?.provider,
    queued: queueAdd.mock.calls[0]?.[1]?.provider,
  }
}

describe("/v1/generate-video runs a text-to-video twin as its image-to-video id", () => {
  it("covers every mode twin", () => {
    expect(VIDEO_MODE_ALIASES.map((g) => g.t2v)).toEqual(expect.arrayContaining(["grok", "wan", "wan-2.7-t2v", "happyhorse"]))
  })

  it.each(VIDEO_MODE_ALIASES.map((g) => [g.t2v, g.i2v] as const))(
    "%s with a start frame runs, is priced and is queued as %s",
    async (t2v, i2v) => {
      const twin = await send({ provider: t2v, imageUrl: START })
      expect(twin.res.statusCode, twin.res.body).toBe(200)
      expect(twin.recorded).toBe(i2v)
      expect(twin.queued).toBe(i2v)

      vi.clearAllMocks()
      const named = await send({ provider: i2v, imageUrl: START })
      expect(named.res.statusCode, named.res.body).toBe(200)
      // Held on exactly the id a request naming the image-to-video id holds on.
      expect(twin.reservedOn).toBeDefined()
      expect(twin.reservedOn).toBe(named.reservedOn)
      expect(twin.reservedOn!.startsWith(i2v)).toBe(true)
    },
  )

  it("grok with reference images alone runs as grok-i2v, which takes them", async () => {
    const { res, recorded, queued } = await send({ provider: "grok", referenceImageUrls: [REF] })
    expect(res.statusCode, res.body).toBe(200)
    expect(recorded).toBe("grok-i2v")
    expect(queued).toBe("grok-i2v")
    expect(queueAdd.mock.calls[0]?.[1]?.referenceImageUrls).toEqual([REF])
  })

  it("a prompt-only request is refused, naming the text-to-video route, before anything is held", async () => {
    const { res } = await send({ provider: "grok" })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("POST /v1/text-to-video")
    expect(jobInsert).not.toHaveBeenCalled()
    expect(jobUpsert).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })
})

describe("every other id is sent as it is named", () => {
  it.each(["grok-i2v", "veo3.1", "seedance-2", "kling-4", "wan-i2v"])("%s", async (provider) => {
    const { res, recorded, queued, reservedOn } = await send({ provider, imageUrl: START })
    expect(res.statusCode, res.body).toBe(200)
    expect(recorded).toBe(provider)
    expect(queued).toBe(provider)
    expect(reservedOn!.startsWith(provider)).toBe(true)
  })

  it("a request naming no model runs on the platform default, as before", async () => {
    const { res, recorded } = await send({ imageUrl: START })
    expect(res.statusCode, res.body).toBe(200)
    const { DEFAULT_VIDEO_PROVIDER } = await import("@nodaro/shared/models")
    expect(recorded).toBe(DEFAULT_VIDEO_PROVIDER)
  })
})

/**
 * The mirror case: an image-to-video id named on /v1/text-to-video. Its
 * schema does not list a twin's image-to-video id (`grok-i2v`), and an
 * image-to-video-only model it lists (`kling-master`) is refused by the
 * handler as needing an image. Both are 400s before anything is held.
 */
describe("/v1/text-to-video refuses an image-to-video id before anything is held", () => {
  it.each([
    ["grok-i2v", "validation_error"],
    ["kling-master", "image_required"],
  ])("%s → %s", async (provider, code) => {
    const { res } = await send({ provider }, "/v1/text-to-video")
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe(code)
    expect(jobInsert).not.toHaveBeenCalled()
    expect(jobUpsert).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(queueAdd).not.toHaveBeenCalled()
  })
})
