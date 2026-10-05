// backend/src/routes/__tests__/add-captions-hook-plate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) } },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 0, watermark: false }),
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { captionRoutesToRemotion, type CaptionPlan } from "@nodaro/shared"
import { CAPTION_SEGMENT_LEVER_KEYS, getFactoryPresets, hookPlateCaptionSegments } from "@nodaro/prompts"
import { addCaptionsBody, addCaptionsRoutes } from "../add-captions.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { supabase } from "../../lib/supabase.js"

const VIDEO = "https://example.com/clip.mp4"
const USER = "00000000-0000-4000-8000-000000000001"
const PLAN: CaptionPlan = {
  v: 1,
  hookText: "Saved 3 hours a week",
  hookEndMs: 1600,
  bodyEndMs: 4300,
  captions: [
    { text: "so", startMs: 1600, endMs: 1900 },
    { text: "I", startMs: 2000, endMs: 2200 },
    { text: "opened", startMs: 2200, endMs: 2600 },
    { text: "Acme", startMs: 2600, endMs: 4000 },
  ],
  videoDurationMs: 8000,
}
const KARAOKE = getFactoryPresets("add-captions").find((p) => p.id === "add-captions/karaoke")!.data
const CASES: ReadonlyArray<[string, ReturnType<typeof hookPlateCaptionSegments>["segments"]]> = [
  ["en", hookPlateCaptionSegments({ ...PLAN, language: "en" }).segments],
  ["he", hookPlateCaptionSegments({ ...PLAN, language: "he" }).segments],
  ["karaoke body", hookPlateCaptionSegments(PLAN, { bodyLevers: KARAOKE }).segments],
]

describe("hookPlateCaptionSegments output against the add-captions route", () => {
  it.each(CASES)("%s: the route's schema accepts the segments and they route to the styled renderer", (_name, segments) => {
    expect(segments).toHaveLength(2)
    const r = addCaptionsBody.safeParse({ videoUrl: VIDEO, segments })
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true)
    expect(captionRoutesToRemotion({ segments })).toBe(true)
    for (const s of segments) expect(captionRoutesToRemotion(s as Parameters<typeof captionRoutesToRemotion>[0])).toBe(true)
  })

  it("CAPTION_SEGMENT_LEVER_KEYS equals the route's segment keys without times and words", () => {
    const segmentShape = addCaptionsBody.shape.segments.unwrap().element.shape
    const routeKeys = Object.keys(segmentShape).filter((k) => !["startMs", "endMs", "text", "captions"].includes(k))
    expect([...CAPTION_SEGMENT_LEVER_KEYS].sort()).toEqual(routeKeys.sort())
  })
})

describe("POST /v1/add-captions with the helper's segments", () => {
  let app: FastifyInstance
  beforeEach(async () => {
    vi.clearAllMocks()
    const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
    vi.mocked(supabase.from).mockReturnValue({ insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }) } as never)
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => addCaptionsRoutes(instance))
    await app.ready()
  })
  afterEach(async () => app.close())

  it.each(CASES)("%s: reserves add-captions:kinetic", async (_name, segments) => {
    const res = await app.inject({ method: "POST", url: "/v1/add-captions", payload: { userId: USER, videoUrl: VIDEO, segments } })
    expect(res.statusCode, res.body).toBe(200)
    expect(vi.mocked(reserveCreditsForJob).mock.calls.at(-1)![3]).toBe("add-captions:kinetic")
  })
})
