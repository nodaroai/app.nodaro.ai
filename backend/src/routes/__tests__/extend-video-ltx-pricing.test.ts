import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// LTX 2.3 Pro Extend is priced per second added: the per-second row times the
// seconds (`ltxExtendDurationSec`: 1-20, default 6). The route's guard prices
// it, the reservation reserves that amount, and the job is sent the very
// seconds that were priced. The workflow payload builder reserves the same
// row and sends the same seconds. Every other extend provider keeps its
// row-priced guard.
// ---------------------------------------------------------------------------

const guardCalls: Array<{ model: string; credits: number | undefined }> = []
const reserveCalls: Array<{ model: string; creditOverride: number | undefined }> = []

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

// The guard as the route wires it: the resolver names the row, computeCredits
// (when the route passes one) prices the run. Markup is the real guard's job
// and is left out here — the amounts below are base credits.
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (resolver: (req: unknown) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number> | number }) =>
    async (req: { body: unknown; creditReservation?: unknown }) => {
      const credits = opts?.computeCredits ? await opts.computeCredits(req.body, req) : undefined
      guardCalls.push({ model: resolver(req), credits })
      req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: false, creditOverride: credits }
    },
  reserveCreditsForJob: vi.fn(async (req: { creditReservation?: { creditOverride?: number } }, _reply: unknown, _jobId: string, model: string) => {
    reserveCalls.push({ model, creditOverride: req.creditReservation?.creditOverride })
    return { usageLogId: "usage-1", creditsReserved: 1, watermark: false }
  }),
}))

vi.mock("@/lib/credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "ltx-2.3-pro-extend:per-second" ? 40 : 999)),
}))

vi.mock("@/lib/kie-task-ownership.js", () => ({
  kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { extendVideoRoutes } from "../extend-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { buildPayload } from "../../services/workflow-engine/payload-builder.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardCalls.length = 0
  reserveCalls.length = 0

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await extendVideoRoutes(instance)
  })
  await app.ready()

  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
  } as never)
})

afterEach(async () => {
  await app.close()
})

const USER = "00000000-0000-4000-8000-000000000001"
const queued = () => vi.mocked(videoQueue.add).mock.calls[0]?.[1] as Record<string, unknown> | undefined

describe("POST /v1/extend-video — LTX 2.3 Pro is priced per second added", () => {
  it.each([
    [2, 80],
    [6, 240],
    [20, 800],
  ])("%i seconds → %i base credits, reserved on the per-second row, and %i seconds sent", async (seconds, credits) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { provider: "ltx-2.3-pro", videoUrl: "https://cdn.example.com/a.mp4", duration: seconds, userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(guardCalls).toEqual([{ model: "ltx-2.3-pro-extend:per-second", credits }])
    expect(reserveCalls).toEqual([{ model: "ltx-2.3-pro-extend:per-second", creditOverride: credits }])
    expect(queued()?.duration).toBe(seconds)
  })

  it("no length given → the model's default 6 seconds, priced and sent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { provider: "ltx-2.3-pro", videoUrl: "https://cdn.example.com/a.mp4", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(guardCalls).toEqual([{ model: "ltx-2.3-pro-extend:per-second", credits: 240 }])
    expect(queued()?.duration).toBe(6)
  })

  it("every other provider keeps its row-priced guard", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/extend-video",
      payload: { provider: "veo-extend", kieTaskId: "task-1", prompt: "keep going", model: "quality", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(guardCalls).toEqual([{ model: "veo-extend:quality", credits: undefined }])
    expect(reserveCalls).toEqual([{ model: "veo-extend:quality", creditOverride: undefined }])
  })
})

describe("workflow payload builder — LTX extend", () => {
  const node = (data: Record<string, unknown>) => ({ id: "n1", type: "extend-video", data })

  it.each([
    [{ duration: 20 }, 20],
    [{ duration: "8" }, 8],
    [{}, 6],
  ])("%j → the per-second row and %i seconds sent", (data, seconds) => {
    const result = buildPayload(node({ provider: "ltx-2.3-pro", ...data }), "job-1", {
      videoUrl: "https://cdn.example.com/a.mp4",
    })
    expect(result.modelIdentifier).toBe("ltx-2.3-pro-extend:per-second")
    expect(result.payload.duration).toBe(seconds)
  })
})

describe("workflow estimate — the quote matches the reservation", () => {
  it.each([
    [{ duration: 2 }, 80],
    [{ duration: 10 }, 400],
    [{ duration: 20 }, 800],
    [{}, 240],
  ])("%j → %i base credits (the per-second row × seconds)", async (data, credits) => {
    const { CreditsService } = await import("../../ee/billing/credits.js")
    expect(
      CreditsService.estimateWorkflowBaseCredits([{ type: "extend-video", data: { provider: "ltx-2.3-pro", ...data } }]),
    ).toBe(credits)
  })
})

describe("workflow estimate — Video Retake is the per-second row × the window", () => {
  it.each([
    [{ retakeDuration: 2.5 }, 100],
    [{ retakeDuration: 6 }, 240],
    [{}, 80],
  ])("%j → %i base credits", async (data, credits) => {
    const { CreditsService } = await import("../../ee/billing/credits.js")
    expect(
      CreditsService.estimateWorkflowBaseCredits([{ type: "video-retake", data: { provider: "ltx-2.3-pro", ...data } }]),
    ).toBe(credits)
  })
})
