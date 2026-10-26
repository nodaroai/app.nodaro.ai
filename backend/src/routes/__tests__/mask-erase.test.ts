/**
 * POST /v1/mask-erase (routes/mask-erase.ts): internal only — the plugin's
 * worker-side child request (`tk.http.workerRequest` with a parent job) is
 * the one caller it serves; every other caller is refused before the mask is
 * probed or anything is priced. Priced one `mask-erase` unit per started 5 s
 * of the mask.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "q-1" }) },
  redis: {},
}))

const reserve = vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 20, watermark: false })
let guardedCredits: number | undefined
let guardedId: string | undefined
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (id: () => string, opts?: { computeCredits?: (body: unknown) => Promise<number> }) =>
    async (req: { body: unknown }) => {
      guardedId = id()
      guardedCredits = opts?.computeCredits ? await opts.computeCredits(req.body) : undefined
    },
  reserveCreditsForJob: (...args: unknown[]) => reserve(...args),
}))

const probe = vi.fn()
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: (url: string) => probe(url) }))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/credit-base-cost.js")>()
  const baseCreditCostFor = async (id: string) => (id === "mask-erase" ? 10 : 0)
  return {
    baseCreditCostFor,
    quoteBaseCredits: real.quoteBaseCredits,
    unitRateBaseCredits: async (id: string, units: number) => real.quoteBaseCredits(await baseCreditCostFor(id), units),
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCommunity: () => false,
  isBusiness: () => false,
  isCloud: () => true,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { maskEraseRoutes } from "../mask-erase.js"
import { maskEraseUnits } from "../../lib/mask-erase-length.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000aa"
const BOX = { fromFrame: 0, toFrame: 99, leftPct: 10, topPct: 10, rightPct: 40, bottomPct: 50 }
const BODY = { maskUrl: "https://example.com/mask.mp4", erase: [BOX], forcePrivate: true }
let app: FastifyInstance
let inserted: Record<string, unknown> | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  guardedCredits = undefined
  guardedId = undefined
  inserted = undefined
  probe.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 12, fps: 30 })
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      inserted = row
      return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-me-1" }, error: null }) }) }
    }),
  } as never)
  app = Fastify({ logger: false })
  // A stand-in for the auth hook: the credential kind the test names, as the user it names.
  app.addHook("preHandler", async (req) => {
    const kind = req.headers["x-test-auth"]
    if (typeof kind === "string") {
      req.userId = USER
      req.authKind = kind as never
    }
  })
  await app.register(async (i) => { await maskEraseRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>, auth: string) =>
  app.inject({ method: "POST", url: "/v1/mask-erase", payload, headers: { "x-test-auth": auth } })
/** As the plugin's `tk.http.workerRequest` reaches it: internal, with a parent job in the server-only scope. */
const asChild = (payload: Record<string, unknown>) =>
  withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/mask-erase", parentJobId: PARENT, trustedPluginCaller: true }, () =>
    post(payload, "internal"),
  )

describe("POST /v1/mask-erase — who may call it", () => {
  it.each(["jwt", "api_token", "app_token", "billing_key"])("refuses a %s caller 403, before probing or pricing anything", async (kind) => {
    const res = await post(BODY, kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(probe).not.toHaveBeenCalled()
    expect(guardedId).toBeUndefined()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a bare internal call (the orchestrator's hop, MCP, a trend route's engine request): no parent job in its scope", async () => {
    expect((await post(BODY, "internal")).statusCode).toBe(403)
    // A trusted plugin request WITHOUT a parent (tk.http.internalRequest) is the user's own job, not a child step.
    const res = await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/mask-erase", trustedPluginCaller: true }, () => post(BODY, "internal"))
    expect(res.statusCode).toBe(403)
    expect(probe).not.toHaveBeenCalled()
  })

  it("refuses an anonymous caller", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/mask-erase", payload: BODY })
    expect(res.statusCode).toBe(403)
  })
})

describe("POST /v1/mask-erase — a child step", () => {
  it("prices one unit per started 5 s of the measured mask, writes the child job and queues it", async () => {
    const res = await asChild(BODY)
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-me-1" })
    expect(probe).toHaveBeenCalledWith("https://example.com/mask.mp4")
    expect(guardedId).toBe("mask-erase")
    // 12 s → 3 units × the 10-credit row.
    expect(guardedCredits).toBe(30)
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-me-1", "mask-erase")
    expect(inserted).toMatchObject({
      user_id: USER,
      force_private: true,
      parent_job_id: PARENT,
      input_data: { type: "mask-erase", maskUrl: BODY.maskUrl, erase: [BOX], billedUnits: 3 },
    })
    expect(videoQueue.add).toHaveBeenCalledWith("mask-erase", { jobId: "job-me-1", maskUrl: BODY.maskUrl, erase: [BOX], usageLogId: "u-1" })
  })

  it("refuses no boxes, more than 50, a box out of order or with a stray key (400, nothing queued)", async () => {
    for (const erase of [[], Array.from({ length: 51 }, () => BOX), [{ ...BOX, fromFrame: 5, toFrame: 4 }], [{ ...BOX, leftPct: 60 }], [{ ...BOX, label: "erased" }]]) {
      const res = await asChild({ ...BODY, erase })
      expect(res.statusCode, JSON.stringify(erase).slice(0, 80)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("refuses a mask that cannot be read, or one longer than 300 s, before pricing it", async () => {
    probe.mockRejectedValueOnce(new Error("moov atom not found"))
    expect((await asChild(BODY)).json().error.code).toBe("invalid_video_duration")
    probe.mockResolvedValueOnce({ durationSeconds: 301 })
    expect((await asChild(BODY)).json().error.code).toBe("video_duration_exceeds_limit")
    expect(guardedId).toBeUndefined()
  })
})

describe("maskEraseUnits", () => {
  it("is one per started 5 s, at least one", () => {
    expect(maskEraseUnits(0.2)).toBe(1)
    expect(maskEraseUnits(5)).toBe(1)
    expect(maskEraseUnits(5.01)).toBe(2)
    expect(maskEraseUnits(10.0000001)).toBe(2)
    expect(maskEraseUnits(30)).toBe(6)
  })
})
