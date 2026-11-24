import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// The free-credit video limits and a Video Remake job's own video step,
// through the REAL credit guard and the REAL server-side submission scope:
//  - an account that never paid has that step admitted (the run, its Full
//    Quality), and only that step: the same account asking the video routes
//    itself is refused as before;
//  - nothing a caller can send claims the step: a body field, a header, an
//    internal hop that is not the plugin toolkit's, another user's job, a job
//    that is no Video Remake run;
//  - the watermark the guard decides for each job: a run's helper clips and
//    pictures (a depth map, a mask, a prepared reference) are stored unmarked
//    on every account, the job that makes the delivered video keeps the
//    account's rule, and the same helper routes asked directly keep it too.
// The routes here stand in for /v1/generate-video and /v1/video-upscale: each
// runs the guard under the id, and with the video request, its route gives it.
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
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
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

import { creditGuard } from "../../../middleware/credit-guard.js"
import { withJobSubmissionContext } from "../../../lib/job-submission-context.js"
import { invalidateModelPricingCache } from "../../billing/credits.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER_USER = "00000000-0000-4000-8000-000000000002"
const PARENT = "11111111-1111-4111-8111-111111111111"
const SECRET = "the-internal-secret"

function profile(paid: boolean, credits = 1_500): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: paid ? "pro" : "free",
      subscription_tier: paid ? "pro" : null,
      lifetime_topup_credits: 0,
      subscription_credits: credits,
      topup_credits: paid ? 50_000 : 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
}

/** The job the child names as its parent, as the server stores it. */
function parent(row: Record<string, unknown> | null, error: unknown = null): void {
  tableResponses.set("jobs", { data: row, error })
}
const remakeRun = (over: Record<string, unknown> = {}) => ({ user_id: USER, job_type: "cast-swap", input_data: { type: "cast-swap" }, ...over })

/** What the route does once its guard admits the request. */
const started = vi.fn()

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  tableResponses.clear()
  tableResponses.set("model_pricing", { data: { credit_cost: 100, is_enabled: true, tier_restriction: null }, error: null })
  invalidateModelPricingCache()
  app = Fastify({ logger: false })
  // The auth hook's part: an internal request is one that carries the secret, and acts as the user it names.
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = String(req.headers["x-internal-user-id"])
    } else {
      req.authKind = "jwt"
      req.userId = USER
    }
  })
  // The watermark the guard decided: what the reservation writes on the job (`should_watermark`).
  const admitted = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    started()
    return reply.status(202).send({ jobId: "child-1", watermark: req.creditReservation?.watermark })
  }
  // As /v1/generate-video: the reserved id and the video request are the body's own model, length and resolution.
  app.post("/v1/generate-video", {
    preHandler: creditGuard((req) => {
      const body = req.body as { provider: string; duration?: number; resolution?: string }
      req.freeVideoRequest = { provider: body.provider, duration: body.duration ?? null, resolution: body.resolution ?? null, videoSize: null }
      return `${body.provider}:${body.duration ?? 8}s`
    }, { computeCredits: () => 100 }),
  }, admitted)
  // As /v1/video-upscale finalizing a draft: reserved under the finalize model's own id.
  app.post("/v1/video-upscale", {
    preHandler: creditGuard(() => "seedance-2-5-hd:8s", { computeCredits: () => 100 }),
  }, admitted)
  // A run's helper routes, each under its own (non-video-model) id.
  for (const url of HELPERS) app.post(url, { preHandler: creditGuard(() => "helper-step", { computeCredits: () => 10 }) }, admitted)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const HELPERS = ["/v1/video-depth", "/v1/video-mask", "/v1/mask-composite", "/v1/mask-erase", "/v1/mask-outline", "/v1/video-face-mesh", "/v1/generate-image"] as const
const GENERATE = "/v1/generate-video"
const UPSCALE = "/v1/video-upscale"
const PRISM = { provider: "seedance-2-5", prompt: "p", duration: 8, resolution: "720p", referenceVideoUrls: ["https://cdn.example.com/clip.mp4"] }
const PREVIEW = { provider: "seedance-2-5", prompt: "p", draft: true, referenceVideoUrls: ["https://cdn.example.com/clip.mp4"] }
const PULSE = { provider: "kling-4", prompt: "p", duration: 8, resolution: "1080p", referenceVideoUrls: ["https://cdn.example.com/clip.mp4"] }
const FINALIZE = { provider: "seedance-2-5-hd", sourceJobId: "22222222-2222-4222-8222-222222222222" }
const TOPAZ = { provider: "topaz", videoUrl: "https://cdn.example.com/take.mp4", targetResolution: "1080p", targetFps: 24, forcePrivate: true }
// The step's model since 2026-11-24: Topaz Rhea.
const RHEA = { provider: "topaz-rhea", videoUrl: "https://cdn.example.com/take.mp4", targetResolution: "1080p", forcePrivate: true }

const internal = (userId = USER) => ({ "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": userId })

/** A request the user sends: no server-side scope at all. */
const direct = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers })

/** A job handler's request through the plugin toolkit (`tk.http.workerRequest`): its scope and its headers. */
const child = (url: string, payload: Record<string, unknown>, scope: { parentJobId?: string; trustedPluginCaller?: boolean; userId?: string } = { parentJobId: PARENT, trustedPluginCaller: true }) =>
  withJobSubmissionContext({ userId: scope.userId ?? USER, method: "POST", url, ...scope }, () =>
    app.inject({ method: "POST", url, payload, headers: internal(scope.userId ?? USER) }))

function refusedAsFreeVideo(res: { statusCode: number; json: () => { error: { code: string } } }): void {
  expect(res.statusCode).toBe(402)
  expect(res.json().error.code).toBe("free_video_limit")
}

describe("a Video Remake job's video step on an account that never paid", () => {
  beforeEach(() => profile(false))

  it.each([
    ["a Prism run", GENERATE, PRISM],
    ["a 4 s preview (a draft)", GENERATE, PREVIEW],
    ["a Pulse run", GENERATE, PULSE],
  ])("admits %s's video child", async (_name, url, body) => {
    parent(remakeRun())
    expect((await child(url, body)).statusCode).toBe(202)
    expect(started).toHaveBeenCalledTimes(1)
  })

  it("admits a Full Quality job's finalize, and its new take", async () => {
    parent(remakeRun({ job_type: "cast-swap-full-quality" }))
    expect((await child(UPSCALE, FINALIZE)).statusCode).toBe(202)
    expect((await child(GENERATE, PULSE)).statusCode).toBe(202)
  })

  it("reads the parent's type from its stored input while the worker has not stamped it yet", async () => {
    parent(remakeRun({ job_type: null }))
    expect((await child(GENERATE, PRISM)).statusCode).toBe(202)
  })

  it("still asks the balance: a step the account cannot pay for is refused for credits", async () => {
    profile(false, 10)
    parent(remakeRun())
    const res = await child(GENERATE, PRISM)
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    expect(started).not.toHaveBeenCalled()
  })

  it("still refuses the same account asking the video routes itself", async () => {
    parent(remakeRun())
    for (const [url, body] of [[GENERATE, PRISM], [GENERATE, PREVIEW], [GENERATE, PULSE], [UPSCALE, FINALIZE]] as const) {
      refusedAsFreeVideo(await direct(url, body))
    }
    expect(started).not.toHaveBeenCalled()
  })

  it("refuses a parent a caller names itself: a body field, a header, a wrong secret", async () => {
    parent(remakeRun())
    refusedAsFreeVideo(await direct(GENERATE, { ...PRISM, parentJobId: PARENT, parent_job_id: PARENT, trustedPluginCaller: true }))
    refusedAsFreeVideo(await direct(GENERATE, PRISM, { "x-parent-job-id": PARENT, "x-internal-user-id": USER, "x-internal-orchestrator-secret": "a-guess" }))
    refusedAsFreeVideo(await direct(UPSCALE, { ...FINALIZE, parentJobId: PARENT }, { "x-parent-job-id": PARENT }))
    expect(started).not.toHaveBeenCalled()
  })

  it("refuses an internal request that carries no scope of the plugin toolkit's", async () => {
    parent(remakeRun())
    // The secret alone (an internal hop with no scope).
    refusedAsFreeVideo(await direct(GENERATE, PRISM, internal()))
    // A scope that names a parent but is not the toolkit's own.
    refusedAsFreeVideo(await child(GENERATE, PRISM, { parentJobId: PARENT }))
    // The toolkit's own request with no parent job (a route's internal request, not a job's step).
    refusedAsFreeVideo(await child(GENERATE, PRISM, { trustedPluginCaller: true }))
    // The toolkit's scope, opened for another route than the one reached.
    refusedAsFreeVideo(await withJobSubmissionContext({ userId: USER, method: "POST", url: UPSCALE, parentJobId: PARENT, trustedPluginCaller: true }, () =>
      app.inject({ method: "POST", url: GENERATE, payload: PRISM, headers: internal() })))
    // The toolkit's scope without the internal sign-in.
    refusedAsFreeVideo(await withJobSubmissionContext({ userId: USER, method: "POST", url: GENERATE, parentJobId: PARENT, trustedPluginCaller: true }, () =>
      app.inject({ method: "POST", url: GENERATE, payload: PRISM })))
    expect(started).not.toHaveBeenCalled()
  })

  it.each([
    ["another user's Video Remake run", remakeRun({ user_id: OTHER_USER })],
    ["a job that is no Video Remake run", remakeRun({ job_type: "generate-video-pro", input_data: { type: "generate-video-pro" } })],
    ["a trend's face-mask make", remakeRun({ job_type: "cast-swap-face-mask", input_data: { type: "cast-swap-face-mask" } })],
    ["a job whose stamped type is another, whatever its input says", remakeRun({ job_type: "text-to-video" })],
    ["a job with no type", { user_id: USER, job_type: null, input_data: null }],
    ["a job that does not exist", null],
  ])("refuses a child whose parent is %s", async (_name, row) => {
    parent(row)
    refusedAsFreeVideo(await child(GENERATE, PRISM))
    refusedAsFreeVideo(await child(UPSCALE, FINALIZE))
    expect(started).not.toHaveBeenCalled()
  })

  it("refuses when the parent cannot be read", async () => {
    parent(null, { message: "unavailable" })
    refusedAsFreeVideo(await child(GENERATE, PRISM))
  })
})

describe("an account that paid", () => {
  it("is admitted on every path, as before", async () => {
    profile(true)
    parent(remakeRun())
    expect((await direct(GENERATE, PRISM)).statusCode).toBe(202)
    expect((await direct(UPSCALE, FINALIZE)).statusCode).toBe(202)
    expect((await child(GENERATE, PULSE)).statusCode).toBe(202)
    expect((await child(UPSCALE, FINALIZE)).statusCode).toBe(202)
  })
})

describe("the watermark of a Video Remake run's own jobs", () => {
  const markOf = (res: { statusCode: number; json: () => { watermark?: boolean } }): boolean | undefined => {
    expect(res.statusCode).toBe(202)
    return res.json().watermark
  }
  const HELPER_BODY = { videoUrl: "https://cdn.example.com/clip.mp4" }

  describe("on an account that never paid", () => {
    beforeEach(() => profile(false))

    it.each(HELPERS)("stores the helper job of %s unmarked", async (url) => {
      parent(remakeRun())
      expect(markOf(await child(url, HELPER_BODY))).toBe(false)
    })

    it("stores a Full Quality job's helper unmarked too", async () => {
      parent(remakeRun({ job_type: "cast-swap-full-quality" }))
      expect(markOf(await child("/v1/video-depth", HELPER_BODY))).toBe(false)
    })

    it.each([
      ["a Prism run's take", GENERATE, PRISM, "cast-swap"],
      ["a 4 s preview's take", GENERATE, PREVIEW, "cast-swap"],
      ["a Pulse run's take", GENERATE, PULSE, "cast-swap"],
      ["a Full Quality finalize", UPSCALE, FINALIZE, "cast-swap-full-quality"],
      ["a Full Quality new take", GENERATE, PULSE, "cast-swap-full-quality"],
    ])("still marks %s, the video the run delivers", async (_name, url, body, type) => {
      parent(remakeRun({ job_type: type }))
      expect(markOf(await child(url, body))).toBe(true)
    })

    it.each([
      ["a run's Precise upscale", "cast-swap"],
      ["a Full Quality's Precise upscale", "cast-swap-full-quality"],
    ])("stores %s (Topaz or Topaz Rhea on the take, already the marked result) unmarked", async (_name, type) => {
      parent(remakeRun({ job_type: type }))
      expect(markOf(await child(UPSCALE, TOPAZ))).toBe(false)
      expect(markOf(await child(UPSCALE, RHEA))).toBe(false)
    })

    it("judges a Topaz or Topaz Rhea upscale asked directly, or under a parent that is no Video Remake run, as before", async () => {
      parent(remakeRun())
      refusedAsFreeVideo(await direct(UPSCALE, TOPAZ))
      refusedAsFreeVideo(await direct(UPSCALE, RHEA))
      parent(remakeRun({ job_type: "generate-video", input_data: { type: "generate-video" } }))
      refusedAsFreeVideo(await child(UPSCALE, TOPAZ))
      refusedAsFreeVideo(await child(UPSCALE, RHEA))
    })

    it("still marks a result route reached with a query string", async () => {
      parent(remakeRun())
      const url = `${GENERATE}?x=1`
      const res = await withJobSubmissionContext({ userId: USER, method: "POST", url, parentJobId: PARENT, trustedPluginCaller: true }, () =>
        app.inject({ method: "POST", url, payload: PRISM, headers: internal() }))
      expect(markOf(res)).toBe(true)
    })

    it.each(HELPERS)("still marks %s asked directly", async (url) => {
      parent(remakeRun())
      expect(markOf(await direct(url, HELPER_BODY))).toBe(true)
    })

    it("still marks a helper route whose caller names the parent or the kind itself", async () => {
      parent(remakeRun())
      const claims = { parentJobId: PARENT, parent_job_id: PARENT, trustedPluginCaller: true, watermark: false, shouldWatermark: false, helper: true, videoRemakeStep: "helper" }
      expect(markOf(await direct("/v1/video-depth", { ...HELPER_BODY, ...claims }))).toBe(true)
      expect(markOf(await direct("/v1/video-depth", HELPER_BODY, { "x-parent-job-id": PARENT, "x-video-remake-step": "helper", "x-internal-user-id": USER, "x-internal-orchestrator-secret": "a-guess" }))).toBe(true)
    })

    it("still marks a helper route on an internal request that is not a Video Remake job's own", async () => {
      parent(remakeRun())
      // The secret alone.
      expect(markOf(await direct("/v1/video-depth", HELPER_BODY, internal()))).toBe(true)
      // A parent named by a scope that is not the toolkit's.
      expect(markOf(await child("/v1/video-depth", HELPER_BODY, { parentJobId: PARENT }))).toBe(true)
      // The toolkit's request with no parent job.
      expect(markOf(await child("/v1/video-depth", HELPER_BODY, { trustedPluginCaller: true }))).toBe(true)
    })

    it.each([
      ["another user's Video Remake run", remakeRun({ user_id: OTHER_USER })],
      ["a job that is no Video Remake run", remakeRun({ job_type: "generate-video-pro", input_data: { type: "generate-video-pro" } })],
      ["a trend's face-mask make", remakeRun({ job_type: "cast-swap-face-mask", input_data: { type: "cast-swap-face-mask" } })],
      ["a job that does not exist", null],
    ])("still marks a helper whose parent is %s", async (_name, row) => {
      parent(row)
      expect(markOf(await child("/v1/video-depth", HELPER_BODY))).toBe(true)
    })

    it("still marks a helper when the parent cannot be read", async () => {
      parent(null, { message: "unavailable" })
      expect(markOf(await child("/v1/video-mask", HELPER_BODY))).toBe(true)
    })
  })

  it("leaves an account that paid unmarked on every path, as before", async () => {
    profile(true)
    parent(remakeRun())
    expect(markOf(await direct("/v1/video-depth", HELPER_BODY))).toBe(false)
    expect(markOf(await child("/v1/video-depth", HELPER_BODY))).toBe(false)
    expect(markOf(await direct(GENERATE, PRISM))).toBe(false)
    expect(markOf(await child(GENERATE, PRISM))).toBe(false)
    expect(markOf(await child(UPSCALE, FINALIZE))).toBe(false)
  })
})
