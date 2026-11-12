import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// POST /v1/extend-video through the REAL credit guard (the door and the Cloud
// check), on both Seedance providers:
//  - an account that never paid may not extend video (the free-credit video
//    limits). The guard is handed the provider the request runs, never left to
//    read the price row's name (a row can be named for no catalog model);
//  - an availability override that withholds one of them refuses it.
// ---------------------------------------------------------------------------

const { mockFrom, tableResponses } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  function createChain(response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(fallback).then(ok, ko),
    }
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "delete"]) chain[m] = vi.fn().mockReturnValue(chain)
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(tableResponses.get(table) ?? null))
  return { mockFrom, tableResponses }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/deployment-payer.js")>()
  return { ...actual, deploymentPayerActive: () => false, deploymentPayerId: () => null, allowanceEnforcementActive: () => false }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/lib/free-video-config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFreeVideoLimits: vi.fn().mockResolvedValue({ enabled: true, maxSeconds: 4 }),
}))
vi.mock("@/ee/billing/purchase-on-record.js", () => ({
  hasPurchaseOnRecord: vi.fn().mockResolvedValue(false),
  invalidatePurchaseOnRecordCache: vi.fn(),
}))
vi.mock("@/ee/lib/welcome-offer-config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWelcomeOfferConfig: vi.fn().mockResolvedValue({ enabled: false }),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))
vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false) }))
// The real guard; only the reservation (after the job row) is stubbed.
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 530, watermark: false }),
}))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeVideoSource: vi.fn().mockResolvedValue({ width: 1280, height: 720, durationSeconds: 10, videoDurationSeconds: 10 }),
}))

import { extendVideoRoutes } from "../extend-video.js"
import { registerRetiredVideoProviderHook } from "../../middleware/retired-video-provider.js"
import { videoQueue } from "../../lib/queue.js"
import { invalidateModelPricingCache } from "../../ee/billing/credits.js"
import { GATEABLE_MODEL_IDS, __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { getFreeVideoLimits } from "../../ee/lib/free-video-config.js"

const USER = "00000000-0000-4000-8000-000000000001"

function profile(paid: boolean): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: paid ? "pro" : "free",
      subscription_tier: paid ? "pro" : null,
      lifetime_topup_credits: 0,
      subscription_credits: 1_500,
      topup_credits: paid ? 50_000 : 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
}

/** Withhold these models from every user (Admin → Availability), every other gateable model on. */
function withhold(...ids: string[]): void {
  __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => !ids.includes(id))) })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getFreeVideoLimits).mockResolvedValue({ enabled: true, maxSeconds: 4 })
  tableResponses.clear()
  tableResponses.set("model_pricing", { data: { credit_cost: 530, is_enabled: true, tier_restriction: null }, error: null })
  tableResponses.set("jobs", { data: { id: "job-1" }, error: null })
  invalidateModelPricingCache()
  app = Fastify({ logger: false })
  registerRetiredVideoProviderHook(app)
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => {
    await extendVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const post = (provider: string) =>
  app.inject({
    method: "POST",
    url: "/v1/extend-video",
    payload: { provider, videoUrl: "https://cdn.example.com/source.mp4", prompt: "she walks out of frame", duration: 4, resolution: "480p" },
  })

describe("POST /v1/extend-video — the free-credit video limits", () => {
  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "seedance-2-extend"])(
    "refuses a never-paid account on both Seedance extend providers (%s)",
    async (provider) => {
      profile(false)
      const res = await post(provider)
      expect(res.statusCode).toBe(402)
      expect(res.json().error.code).toBe("free_video_limit")
      expect(res.json().error.message).toMatch(/Extending video is not available on free credits/)
      expect(videoQueue.add).not.toHaveBeenCalled()
    },
  )

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("runs for a paying account (%s)", async (provider) => {
    profile(true)
    const res = await post(provider)
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  // LTX 2.3 Pro extends under its generation model's id and is priced on a
  // row named for no catalog model (`ltx-2.3-pro-extend:per-second`): the
  // request itself must say it is an extension, or it is never refused.
  it("refuses a never-paid account on LTX 2.3 Pro Extend", async () => {
    profile(false)
    const res = await post("ltx-2.3-pro")
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("free_video_limit")
    expect(res.json().error.message).toMatch(/^Extending video is not available on free credits/)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses it as an extension even where the free length setting covers LTX's own clip lengths", async () => {
    profile(false)
    vi.mocked(getFreeVideoLimits).mockResolvedValue({ enabled: true, maxSeconds: 10 })
    const res = await post("ltx-2.3-pro")
    expect(res.statusCode).toBe(402)
    expect(res.json().error.message).toMatch(/^Extending video is not available on free credits/)
  })

  it.each(["veo-extend", "runway-extend"])("refuses a never-paid account on %s (unchanged)", async (provider) => {
    profile(false)
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { provider, taskId: "kie-task-1", prompt: "she walks out of frame" },
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.message).toMatch(/^Extending video is not available on free credits/)
  })

  it("runs LTX 2.3 Pro Extend for a paying account", async () => {
    profile(true)
    const res = await post("ltx-2.3-pro")
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })
})

describe("POST /v1/extend-video — Kling 4 (kling-4-extend)", () => {
  const postKling = () =>
    app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { provider: "kling-4-extend", videoUrl: "https://cdn.example.com/source.mp4", prompt: "she walks out of frame", duration: 5, resolution: "720p" },
    })

  it("refuses a never-paid account (no extension on free credits)", async () => {
    profile(false)
    const res = await postKling()
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("free_video_limit")
    expect(res.json().error.message).toMatch(/^Extending video is not available on free credits/)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("runs for a paying account", async () => {
    profile(true)
    const res = await postKling()
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  // A new engine ships withheld: a stored override that predates it lists
  // every model it knew (Kling 4.0 generation among them) but not
  // kling-4-extend, which is its own catalog model — so it is refused until
  // an admin ticks it, while Kling 4.0 generation is untouched.
  it("is refused while a stored availability override does not list it, Kling 4.0 generation or not", async () => {
    profile(true)
    withhold("kling-4-extend")
    expect(GATEABLE_MODEL_IDS.has("kling-4-extend")).toBe(true)
    const refused = await postKling()
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe("model_not_available")
    expect(refused.json().error.message).toContain("kling-4-extend")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})

describe("POST /v1/extend-video — availability", () => {
  it("an availability override withholding seedance-2-0-extend refuses it", async () => {
    profile(true)
    withhold("seedance-2-0-extend")
    const refused = await post("seedance-2-0-extend")
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe("model_not_available")
    expect(refused.json().error.message).toContain("seedance-2-0-extend")
    // Seedance 2.5 stays available.
    expect((await post("seedance-2-5-extend")).statusCode).toBe(200)
  })

  it("the retired id is judged as the Seedance 2.5 it runs as", async () => {
    profile(true)
    withhold("seedance-2-5-extend")
    const res = await post("seedance-2-extend")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain("seedance-2-5-extend")
    expect((await post("seedance-2-0-extend")).statusCode).toBe(200)
  })
})
