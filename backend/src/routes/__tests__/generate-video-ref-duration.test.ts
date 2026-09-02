import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Reference-VIDEO duration pre-check (Task 12).
//
// KIE rejects an out-of-bounds reference clip AFTER the task is created
// ("Each reference video must be between 2 and 30 seconds", app-reports §11.3),
// so the user paid for a run that could never start. Both video routes already
// ffprobe every reference video to PRICE the run, so the durations are in hand
// before the job exists — this suite pins that they are now also CHECKED, in a
// preHandler that runs before creditGuard, and that the probe is reused rather
// than repeated.
//
// What is pinned here:
//   1. An over-long clip is a 400 `video_too_long` with NOTHING reserved.
//   2. A legal set still reserves, and ffprobe runs exactly ONCE per clip
//      (the pre-check probes; computeCredits reads the stash) — R15.
//   3. R16: seedance-2-5 accepts 10 reference videos, so all 10 are probed and
//      priced. The old SEEDANCE_2_REF_LIMITS.videos=3 slice under-reserved.
//   4. A FAILED probe (NaN) neither rejects the request nor lowers the
//      reservation — the 15s worst case is still charged for that clip.
//   5. A provider with no declared limit (seedance-2) is not pre-probed at all.
//
// Mock style: the RELATIVE whole-module form the ref-video billing suites use
// (seedance2-ref-video-billing.test.ts:43-46). Do not mix it with the
// alias+importOriginal form — that is what makes a probe mock silently not apply.
// ---------------------------------------------------------------------------

// Edition is togglable so the SAME suite can prove the check runs in community.
// `creditGuard` reads hasCredits() at route-REGISTRATION time and every test
// builds a fresh app, so flipping this before buildApp() is enough.
const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("../../lib/config.js", () => ({
  config: { EDITION: edition.credits ? "cloud" : "community" },
  hasCredits: () => edition.credits,
  isCommunity: () => !edition.credits,
  isBusiness: () => false,
  isCloud: () => edition.credits,
  hasAdmin: () => edition.credits,
}))

vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })),
}))
vi.mock("../../lib/url-validator.js", () => ({
  safeUrlSchema: z.string().url(),
}))

// ffprobe: per-URL durations, so a single request can mix legal, illegal and
// unreadable clips. An unmapped URL resolves to 5s; the literal "fail" URL
// rejects (the probe-failure lane).
const durationByUrl = new Map<string, number>()
const probeSpy = vi.fn((url: string) => {
  if (url.includes("fail")) return Promise.reject(new Error("ffprobe exited 1"))
  return Promise.resolve(durationByUrl.get(url) ?? 5)
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: probeSpy,
}))

// Spy on the gate's ENTRY POINT (not just the probe it drives), so a test can
// assert WHICH provider the preHandler resolved to — the thing an omitted
// `provider` used to get wrong (`body.provider ?? ""` instead of running it
// through `applyDefaultVideoSelection`, the same helper creditGuard/
// computeCredits use). Wraps the real implementation so every existing
// assertion in this file (which never inspects the spy) is unaffected.
const probeAndCheckSpy = vi.fn()
vi.mock("../../lib/ref-video-probe.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/ref-video-probe.js")>("../../lib/ref-video-probe.js")
  return {
    ...actual,
    probeAndCheckRefVideoDurations: (args: Parameters<typeof actual.probeAndCheckRefVideoDurations>[0]) => {
      probeAndCheckSpy(args)
      return actual.probeAndCheckRefVideoDurations(args)
    },
  }
})

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 1_000_000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

const fakeJobInsert = vi.fn(() => ({
  select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }),
}))
const fakeJobUpsert = vi.fn(() => ({
  select: () => Promise.resolve({ data: [{ id: "job-1" }], error: null }),
}))
const fakeJobUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: fakeJobInsert, upsert: fakeJobUpsert, update: fakeJobUpdate }
      // model_pricing MISS → getModelCreditBaseCost falls back to real STATIC_CREDIT_COSTS.
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: "no row" } }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn(() => Promise.resolve({ usageLogId: "log-1", creditsReserved: 0, watermark: false }))
const checkSpy = vi.fn(() => Promise.resolve({ allowed: true, watermark: false }))

vi.mock("../../ee/billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/credits.js")>("../../ee/billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: checkSpy,
      reserveCredits: reserveSpy,
    },
  }
})

vi.mock("../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

beforeEach(() => {
  vi.clearAllMocks()
  durationByUrl.clear()
  edition.credits = true
})

async function buildApp(which: "generate-video" | "text-to-video"): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as any).userId = "u-1"
    ;(req as any).isAppRun = false
  })
  if (which === "generate-video") {
    const { generateVideoRoutes } = await import("../generate-video.js")
    await generateVideoRoutes(app)
  } else {
    const { textToVideoRoutes } = await import("../text-to-video.js")
    await textToVideoRoutes(app)
  }
  return app
}

const refUrl = (n: number) => `https://r2.example.com/ref-${n}.mp4`

/** perSecBase for seedance-2-5 @720p = STATIC["seedance-2-5:8s:720p-ref"]/8 = 760/8 = 95. */
const SEEDANCE_2_5_720P_PER_SEC = 95

describe("reference-video duration pre-check — /v1/generate-video", () => {
  it("400s `video_too_long` for an over-long clip and reserves NOTHING", async () => {
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain("between 2 and 30 seconds")
    // The whole point: rejected BEFORE the job exists and before any credit
    // bookkeeping. creditGuard never even ran its CHECK.
    expect(checkSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    expect(fakeJobUpsert).not.toHaveBeenCalled()
    await app.close()
  })

  it("400s when each clip is legal but the TOTAL exceeds the 30s cap", async () => {
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 20)
    durationByUrl.set(refUrl(2), 20)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1), refUrl(2)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain("30 seconds in total")
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("R15: a legal set reserves, and ffprobe runs exactly ONCE per clip", async () => {
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 5)
    durationByUrl.set(refUrl(2), 5)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1), refUrl(2)],
      },
    })
    expect(res.statusCode).toBe(200)
    // 2 clips, 2 probes — NOT 4. computeCredits priced from the pre-check's stash.
    expect(probeSpy).toHaveBeenCalledTimes(2)
    // ceil(95 × (5 + 5 + 8)) = 1710
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(SEEDANCE_2_5_720P_PER_SEC * 18) }),
    )
    await app.close()
  })

  it("R16: all 10 accepted clips are probed and priced (the old slice stopped at 3)", async () => {
    const app = await buildApp("generate-video")
    const urls = Array.from({ length: 10 }, (_, i) => refUrl(i + 1))
    for (const u of urls) durationByUrl.set(u, 3)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: urls,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).toHaveBeenCalledTimes(10)
    for (const u of urls) expect(probeSpy).toHaveBeenCalledWith(u)
    // 10 × 3s = 30s in + 8s out → ceil(95 × 38) = 3610.
    // The pre-R16 3-clip slice would have reserved ceil(95 × 17) = 1615.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(SEEDANCE_2_5_720P_PER_SEC * 38) }),
    )
    await app.close()
  })

  it("a FAILED probe neither rejects nor lowers the reservation (15s worst case still charged)", async () => {
    const app = await buildApp("generate-video")
    const bad = "https://r2.example.com/fail.mp4"
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [bad],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).toHaveBeenCalledTimes(1)
    // NaN → ignored by the CHECK, but still the 15s worst case for the DEBIT:
    // ceil(95 × (15 + 8)) = 2185.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(SEEDANCE_2_5_720P_PER_SEC * 23) }),
    )
    await app.close()
  })

  it("a provider with no declared limit is never pre-probed (seedance-2 keeps its old path)", async () => {
    const app = await buildApp("generate-video")
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(200)
    // Exactly one probe — from computeCredits, not the pre-check.
    expect(probeSpy).toHaveBeenCalledTimes(1)
    // Unchanged: ceil((500/8) × (5 + 8)) = 813.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 813 }),
    )
    await app.close()
  })

  it("does nothing when there are no reference videos at all", async () => {
    const app = await buildApp("generate-video")
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("reference-video duration pre-check — /v1/text-to-video", () => {
  it("400s `video_too_long` before creditGuard runs", async () => {
    const app = await buildApp("text-to-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(checkSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    expect(fakeJobUpsert).not.toHaveBeenCalled()
    await app.close()
  })

  it("R15/R16: 10 legal clips → one probe each, all of them priced", async () => {
    const app = await buildApp("text-to-video")
    const urls = Array.from({ length: 10 }, (_, i) => refUrl(i + 1))
    for (const u of urls) durationByUrl.set(u, 3)
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: urls,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).toHaveBeenCalledTimes(10)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(SEEDANCE_2_5_720P_PER_SEC * 38) }),
    )
    await app.close()
  })
})

describe("reference-video duration pre-check — community edition (no credits)", () => {
  // The check is INPUT VALIDATION, not a credit feature: an over-long clip is
  // rejected by the provider whether or not the install bills for anything. It
  // must therefore fire with hasCredits()=false, and it must do so WITHOUT
  // loading any ee/billing module — which is why the probe lives in core
  // (lib/ref-video-probe.ts), imported statically by the preHandler.
  it("still 400s `video_too_long` for an over-long clip", async () => {
    edition.credits = false
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain("between 2 and 30 seconds")
    expect(probeSpy).toHaveBeenCalledTimes(1)
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    await app.close()
  })

  it("400s on /v1/text-to-video too", async () => {
    edition.credits = false
    const app = await buildApp("text-to-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("lets a legal set through with nothing reserved (and no pricing probe)", async () => {
    edition.credits = false
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 5)
    durationByUrl.set(refUrl(2), 5)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: [refUrl(1), refUrl(2)],
      },
    })
    expect(res.statusCode).toBe(200)
    // Validated, not billed: the preHandler probed each clip exactly once and
    // no reservation was made (computeCredits never runs without credits).
    expect(probeSpy).toHaveBeenCalledTimes(2)
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(checkSpy).not.toHaveBeenCalled()
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// Task 14 — the minimax-h3 lane.
//
// §4.3 of the app-reports triage ruled out the reference COUNT for the two P4
// rows but never checked the DURATION: the clip was 52.838s against the
// provider's own "[2000, 15000] ms". h3's credit hook already ffprobed it to
// price the run and then threw the number away — the same shape Task 12 fixed
// for seedance. Now it rides the SAME preHandler, SAME checker, SAME stash.
//
// perSecBase for minimax-h3 @2K = STATIC["minimax-h3:8s"]/8 = 730/8 = 91.25.
// ---------------------------------------------------------------------------

const H3_2K_PER_SEC = 91.25

describe("reference-video duration pre-check — minimax-h3", () => {
  it("400s `video_too_long` for the exact 52.838s clip from the two P4 rows", async () => {
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { provider: "minimax-h3", duration: 8, referenceVideoUrls: [refUrl(1)] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain("between 2 and 15 seconds")
    expect(checkSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    expect(fakeJobUpsert).not.toHaveBeenCalled()
    await app.close()
  })

  it("400s when each clip is legal but the TOTAL exceeds the 15s combined cap", async () => {
    const app = await buildApp("generate-video")
    for (const n of [1, 2, 3]) durationByUrl.set(refUrl(n), 6)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: [refUrl(1), refUrl(2), refUrl(3)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("15 seconds in total")
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("R15: a legal clip reserves 1187 and ffprobe runs exactly ONCE", async () => {
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 5)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { provider: "minimax-h3", duration: 8, referenceVideoUrls: [refUrl(1)] },
    })
    expect(res.statusCode).toBe(200)
    // One probe, not two: computeCredits priced from the pre-check's stash.
    expect(probeSpy).toHaveBeenCalledTimes(1)
    // ceil(91.25 × (5 + 8)) = 1187 — unchanged by this task.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(H3_2K_PER_SEC * 13) }),
    )
    await app.close()
  })

  it("probes and prices the PROVIDER's 3 clips, not the routes' flat 10-URL ceiling", async () => {
    // (A): the routes' Zod cap is SEEDANCE_2_5_REF_LIMITS.videos = 10 for every
    // provider, but h3 takes 3 (VIDEO_REF_LIMITS_BY_PROVIDER["minimax-h3"]) and
    // resolveSeedance2Inputs truncates to 3 before dispatch. Probing/pricing
    // the same 3 is what keeps CHECK == DEBIT == what actually ships.
    const app = await buildApp("generate-video")
    const urls = Array.from({ length: 10 }, (_, i) => refUrl(i + 1))
    for (const u of urls) durationByUrl.set(u, 5)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { provider: "minimax-h3", duration: 8, referenceVideoUrls: urls },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).toHaveBeenCalledTimes(3)
    // 3 × 5s = 15s in + 8s out → ceil(91.25 × 23) = 2099.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(H3_2K_PER_SEC * 23) }),
    )
    await app.close()
  })

  it("a FAILED probe neither rejects nor lowers the reservation (15s worst case)", async () => {
    const app = await buildApp("generate-video")
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/fail.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(probeSpy).toHaveBeenCalledTimes(1)
    // NaN → ignored by the CHECK, still the 15s worst case for the DEBIT:
    // ceil(91.25 × (15 + 8)) = 2099. h3's worst case IS its documented maxSec.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: Math.ceil(H3_2K_PER_SEC * 23) }),
    )
    await app.close()
  })

  it("400s on /v1/text-to-video too, before creditGuard runs", async () => {
    const app = await buildApp("text-to-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: [refUrl(1)],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(res.json().error.message).toContain("between 2 and 15 seconds")
    expect(checkSpy).not.toHaveBeenCalled()
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    await app.close()
  })

  it("still 400s with credits disabled (community): validation, not billing", async () => {
    edition.credits = false
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 52.838)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: { provider: "minimax-h3", duration: 8, referenceVideoUrls: [refUrl(1)] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("video_too_long")
    expect(reserveSpy).not.toHaveBeenCalled()
    expect(fakeJobInsert).not.toHaveBeenCalled()
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// Provider omitted — the gate must resolve through the SAME default as
// creditGuard/computeCredits (`applyDefaultVideoSelection`), not the raw
// `body.provider` field. Before this fix the preHandler keyed on
// `body.provider ?? ""`, so an omitted provider was probed/checked against
// `VIDEO_REF_VIDEO_DURATION_LIMITS[""]` (always undefined) instead of the row
// for whatever provider pricing actually defaults to — silently skipping the
// duration gate for exactly the request shape used when a caller lets the
// platform choose the provider.
//
// This deliberately does NOT hardcode a provider name or an expected status
// code: `DEFAULT_VIDEO_PROVIDER` (today seedance-2-fast, no declared bound) is
// this module's business, not the gate's. What is pinned is that the
// preHandler's probe/check call receives the SAME provider
// `applyDefaultVideoSelection({})` resolves to — read live from
// `@nodaro/shared` — so the test stays meaningful whether or not the default
// ever gains a row in `VIDEO_REF_VIDEO_DURATION_LIMITS`.
// ---------------------------------------------------------------------------
describe("reference-video duration pre-check — provider omitted (gate parity with pricing)", () => {
  it("/v1/generate-video: omitted provider is probed/checked as the SAME provider pricing defaults to", async () => {
    const { applyDefaultVideoSelection, VIDEO_REF_VIDEO_DURATION_LIMITS } = await import("@nodaro/shared")
    const defaultProvider = applyDefaultVideoSelection({}).provider
    const app = await buildApp("generate-video")
    durationByUrl.set(refUrl(1), 9999) // over ANY declared provider's max today
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      // provider deliberately omitted
      payload: { duration: 8, referenceVideoUrls: [refUrl(1)] },
    })
    expect(probeAndCheckSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: defaultProvider }))
    if (VIDEO_REF_VIDEO_DURATION_LIMITS[defaultProvider]) {
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("video_too_long")
      expect(reserveSpy).not.toHaveBeenCalled()
    } else {
      expect(res.statusCode).toBe(200)
      expect(probeSpy).not.toHaveBeenCalled()
    }
    await app.close()
  })

  it("/v1/text-to-video: omitted provider is probed/checked as the SAME provider pricing defaults to", async () => {
    const { applyDefaultVideoSelection, VIDEO_REF_VIDEO_DURATION_LIMITS } = await import("@nodaro/shared")
    const defaultProvider = applyDefaultVideoSelection({}).provider
    const app = await buildApp("text-to-video")
    durationByUrl.set(refUrl(1), 9999) // over ANY declared provider's max today
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      // provider deliberately omitted
      payload: { prompt: "a cat", duration: 8, referenceVideoUrls: [refUrl(1)] },
    })
    expect(probeAndCheckSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: defaultProvider }))
    if (VIDEO_REF_VIDEO_DURATION_LIMITS[defaultProvider]) {
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("video_too_long")
      expect(reserveSpy).not.toHaveBeenCalled()
    } else {
      expect(res.statusCode).toBe(200)
      expect(probeSpy).not.toHaveBeenCalled()
    }
    await app.close()
  })
})
