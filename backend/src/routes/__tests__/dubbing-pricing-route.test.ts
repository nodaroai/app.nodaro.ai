import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// POST /v1/dubbing prices the dubbed span per minute. A source it can measure
// — an upload, or a link (a post through the social-post probe, any other
// link by ffprobe) — is reserved at its span. One it cannot measure holds the
// 30-minute ceiling and is marked so delivery settles it to the span dubbed.

const mocks = vi.hoisted(() => ({
  guardCalls: [] as Array<number | undefined>,
  probe: vi.fn(),
  postProbe: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: mocks.insert })),
    auth: { getUser: vi.fn() },
  },
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn(async (_req: unknown, row: Record<string, unknown>) => {
    mocks.insert(row)
    return { data: { id: "job-1" }, error: null }
  }),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (_resolver: unknown, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number> | number }) =>
    async (req: { body: unknown }) => {
      mocks.guardCalls.push(opts?.computeCredits ? await opts.computeCredits(req.body, req) : undefined)
    },
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "u-1", creditsReserved: 1, watermark: false })),
}))
vi.mock("@/lib/credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "elevenlabs-dubbing" ? 40 : 999)),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  return { ...(await importOriginal<Record<string, unknown>>()), safeUrlSchema: z.string().url() }
})
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))
vi.mock("@/services/workflow-engine/video-analysis-post-probe.js", () => ({ probeSocialPostDurationSec: mocks.postProbe }))

import { dubbingRoutes } from "../dubbing.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.guardCalls.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(async (instance) => {
    await dubbingRoutes(instance)
  })
  await app.ready()
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/dubbing", payload: { targetLanguage: "fr", ...payload } })
const inserted = () => mocks.insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }
const queued = () => mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>

describe("POST /v1/dubbing — priced per minute of the dubbed span", () => {
  it("an upload of 6 min 41 s is reserved at 7 minutes (280 base)", async () => {
    mocks.probe.mockResolvedValue(401)
    const res = await post({ videoUrl: "https://cdn.example.com/v.mp4" })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([280])
    expect(inserted().input_data).toMatchObject({ probedDurationSec: 401 })
    expect(inserted().input_data.reservedCeiling).toBeUndefined()
  })

  it("a post link is measured through the social-post probe (95 s → 80 base)", async () => {
    mocks.postProbe.mockResolvedValue(95)
    const res = await post({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
    expect(res.statusCode).toBe(200)
    expect(mocks.postProbe).toHaveBeenCalledOnce()
    expect(mocks.guardCalls).toEqual([80])
    expect(queued().probedDurationSec).toBe(95)
  })

  it("a direct media link is measured by ffprobe", async () => {
    mocks.probe.mockResolvedValue(150)
    const res = await post({ sourceUrl: "https://media.example.com/clip.mp4" })
    expect(res.statusCode).toBe(200)
    expect(mocks.probe).toHaveBeenCalledWith("https://media.example.com/clip.mp4")
    expect(mocks.guardCalls).toEqual([120])
  })

  it("a link that cannot be measured holds the 30-minute ceiling (1,200 base) and is marked to settle", async () => {
    mocks.probe.mockRejectedValue(new Error("not a media file"))
    const res = await post({ sourceUrl: "https://example.com/some-page" })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([1200])
    expect(inserted().input_data).toMatchObject({ reservedCeiling: true })
    expect(queued()).toMatchObject({ reservedCeiling: true })
  })

  it("a link over 30 minutes is refused before anything is reserved", async () => {
    mocks.postProbe.mockResolvedValue(31 * 60)
    const res = await post({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
    expect(res.statusCode).toBe(413)
    expect(mocks.guardCalls).toEqual([])
  })
})
