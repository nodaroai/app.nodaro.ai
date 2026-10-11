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
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: (...args: unknown[]) => reserve(...args),
}))

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

import { maskCompositeRoutes } from "../mask-composite.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

const USER = "00000000-0000-4000-8000-000000000001"
const URLS = { foregroundUrl: "https://example.com/fg.mp4", backgroundUrl: "https://example.com/bg.mp4", maskUrl: "https://example.com/mask.mp4" }
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(supabase.from).mockReturnValue({
    insert: vi.fn().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-mc-1" }, error: null }) }) }),
  } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (i) => { await maskCompositeRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/mask-composite", payload })

describe("POST /v1/mask-composite", () => {
  it("fills the defaults and enqueues the composite at the flat row", async () => {
    const res = await post({ ...URLS, userId: USER })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-mc-1" })
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-mc-1", "mask-composite")
    expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", {
      jobId: "job-mc-1", ...URLS, invertMask: false, feather: 2, grow: 0, backgroundFit: "cover", audioSource: "foreground", usageLogId: "u-1",
    })
  })

  it("passes explicit settings through", async () => {
    await post({ ...URLS, invertMask: true, feather: 8, grow: -3, backgroundFit: "contain", audioSource: "mix", userId: USER })
    expect(videoQueue.add).toHaveBeenCalledWith("mask-composite", expect.objectContaining({ invertMask: true, feather: 8, grow: -3, backgroundFit: "contain", audioSource: "mix" }))
  })

  it("refuses a missing input and out-of-range settings", async () => {
    const { maskUrl: _m, ...noMask } = URLS
    expect((await post({ ...noMask, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, feather: 21, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, grow: 11, userId: USER })).statusCode).toBe(400)
    expect((await post({ ...URLS, backgroundFit: "tile", userId: USER })).statusCode).toBe(400)
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 401 without a user", async () => {
    expect((await post(URLS)).statusCode).toBe(401)
  })
})
