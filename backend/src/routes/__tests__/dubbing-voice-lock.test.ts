/**
 * POST /v1/dubbing under a voice lock (`voice.allowedGenders`). A dub speaks in
 * clones of the source's speakers, or in voices the dubbing service picks
 * itself, so no voice it produces is one the platform can vouch for: under a
 * lock every dub is refused (fail closed). The refusal is the route's FIRST
 * step, so a refused dub probes no media, reads no import gate, prices nothing
 * and creates no job. With no lock the route is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  guardCalls: 0,
  probe: vi.fn(),
  postProbe: vi.fn(),
  requireImportAllowed: vi.fn(async (_url: string, _rights: Record<string, unknown>): Promise<void> => undefined),
  insert: vi.fn(),
  queueAdd: vi.fn(),
  reserve: vi.fn(async () => ({ usageLogId: "u-1", creditsReserved: 1, watermark: false })),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn(async (_req: unknown, row: Record<string, unknown>) => {
    mocks.insert(row)
    return { data: { id: "job-1" }, error: null }
  }),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => { mocks.guardCalls++ },
  reserveCreditsForJob: mocks.reserve,
}))
vi.mock("@/lib/credit-base-cost.js", () => ({ baseCreditCostFor: vi.fn(async () => 40) }))
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
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
}))

import { dubbingRoutes } from "../dubbing.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.guardCalls = 0
  mocks.probe.mockResolvedValue(60)
  mocks.postProbe.mockResolvedValue(60)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = USER_ID })
  await app.register(async (instance) => { await dubbingRoutes(instance) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

function lock(allowedGenders: string[]): void {
  // The gate is open (config mock: isCloud → true); the profile is read fresh.
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders } })
  __resetSurfaceProfileCacheForTests()
}

const dub = (source: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/dubbing", payload: { targetLanguage: "fr", ...source } })

describe("POST /v1/dubbing — the voice lock", () => {
  it.each([
    ["an uploaded video", { videoUrl: "https://cdn.example.com/v.mp4" }],
    ["an uploaded audio file", { audioUrl: "https://cdn.example.com/a.mp3" }],
    ["a link the service fetches", { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
  ])("refuses a dub of %s under any lock, before anything else runs", async (_label, source) => {
    for (const allowed of [["male"], ["female", "neutral"]]) {
      lock(allowed)
      const res = await dub(source)
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toEqual({ code: "voice_not_available", message: "Dubbing is not available on this deployment." })
    }
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.postProbe).not.toHaveBeenCalled()
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.guardCalls).toBe(0)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("with no lock, dubs as before", async () => {
    const res = await dub({ videoUrl: "https://cdn.example.com/v.mp4" })

    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toBe(1)
    expect(mocks.queueAdd).toHaveBeenCalledWith("dubbing", expect.objectContaining({ jobId: "job-1", targetLanguage: "fr" }))
  })
})
