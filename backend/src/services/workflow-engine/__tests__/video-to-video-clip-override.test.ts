/**
 * Video to Video on HappyHorse Edit / Wan 2.7 VideoEdit — the workflow run's
 * reservation (decided 2026-11-18). The run stamps the clip's length
 * (`stampVideoToVideoClipInput`) before anything is held and reserves the row
 * that length chose; a rate is charged by `computeVideoToVideoClipCreditOverride`
 * (row × units, rounded up once, marked up once) — exactly what the route's
 * guard holds for the same clip, on both sides of Wan 2.7 VideoEdit's
 * break-even. The size priced is the size sent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { ROWS } = vi.hoisted(() => ({ ROWS: {
  "wan-videoedit": 320,
  "wan-videoedit:1080p:per-4s": 240,
  "happyhorse-edit:720p:per-4s": 560,
  "happyhorse-edit:1080p:per-4s": 960,
} as Record<string, number> }))
const { mockGetAppSettings, clip } = vi.hoisted(() => ({ mockGetAppSettings: vi.fn(), clip: { sec: 10 as number | "unreadable" } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: ROWS[id] ?? 999, isEnabled: true, tierRestriction: null })),
}))
// The seeded rows, and the real composition: the row × the units, rounded up once.
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  baseCreditCostFor: async (id: string) => ROWS[id] ?? 0,
  unitRateBaseCredits: async (rateId: string, units: number) => Math.ceil((ROWS[rateId] ?? 0) * units),
}))
vi.mock("@/lib/video-utility-probe.js", () => ({
  probeClipLengthSec: vi.fn(async () => {
    if (clip.sec === "unreadable") throw new Error("ffprobe: Invalid data")
    return clip.sec
  }),
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

import type { FastifyReply, FastifyRequest } from "fastify"
import { computeVideoToVideoClipCreditOverride } from "../node-executor.js"
import { stampVideoToVideoClipInput, videoToVideoReserveId } from "../../../lib/video-to-video-clip-input.js"
import { videoToVideoPricing } from "../../../routes/video-to-video.js"
import { applyServiceMarkup } from "../../../ee/billing/service-margin.js"

const SETTINGS = { cost_markup_percent: 10 }

/** What the route's guard holds for this body and clip: its clip step, its row, its computeCredits, marked up once (a flat row: the row). */
async function routeHold(body: Record<string, unknown>): Promise<{ id: string; credits: number }> {
  const req = { body: { ...body }, log: { warn: () => {} } } as unknown as FastifyRequest
  const reply = { sent: false, status() { return this }, send() { (this as { sent: boolean }).sent = true; return this } } as unknown as FastifyReply
  await videoToVideoPricing.opts!.beforePricing!(req, reply)
  if ((reply as unknown as { sent: boolean }).sent) throw new Error("refused")
  const id = videoToVideoPricing.modelResolver(req)
  const base = await videoToVideoPricing.opts!.computeCredits!(req.body, req)
  return { id, credits: applyServiceMarkup(base ?? ROWS[id]!, SETTINGS as never, id) }
}

/** What the workflow run reserves for the same payload: the stamp, its reserve id, its override (a flat row: the row). */
async function runHold(payload: Record<string, unknown>): Promise<{ id: string; credits: number; payload: Record<string, unknown> }> {
  const p = { ...payload }
  expect(await stampVideoToVideoClipInput("video-to-video", p)).toBeUndefined()
  const id = videoToVideoReserveId("video-to-video", p)!
  const override = await computeVideoToVideoClipCreditOverride("video-to-video", p, id)
  return { id, credits: override ?? applyServiceMarkup(ROWS[id]!, SETTINGS as never, id), payload: p }
}

describe("the workflow run holds what the route holds for the same clip", () => {
  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue(SETTINGS)
    clip.sec = 10
  })

  it.each([
    ["HappyHorse Edit 720p, 3.00 s", { provider: "happyhorse-edit" }, 3, "happyhorse-edit:720p:per-4s", 420],
    ["HappyHorse Edit 720p, 10.04 s", { provider: "happyhorse-edit", resolution: "720p" }, 10.04, "happyhorse-edit:720p:per-4s", 1470],
    ["HappyHorse Edit 1080p, 3.00 s", { provider: "happyhorse-edit", resolution: "1080p" }, 3, "happyhorse-edit:1080p:per-4s", 720],
    ["Wan 2.7 VideoEdit, 5 s (below break-even: the flat row)", { provider: "wan-videoedit" }, 5, "wan-videoedit", 320],
    ["Wan 2.7 VideoEdit, 6 s (past break-even: the rate)", { provider: "wan-videoedit" }, 6, "wan-videoedit:1080p:per-4s", 360],
    ["Wan 2.7 VideoEdit, 10 s at 720p", { provider: "wan-videoedit", resolution: "720p" }, 10, "wan-videoedit:1080p:per-4s", 600],
  ])("%s", async (_label, over, sec, id, base) => {
    clip.sec = sec
    const route = await routeHold({ videoUrl: "https://cdn.test/clip.mp4", ...over })
    const run = await runHold({ videoUrl: "https://cdn.test/clip.mp4", ...over })
    expect(route.id).toBe(id)
    expect(run.id).toBe(id)
    expect(route.credits).toBe(applyServiceMarkup(base, SETTINGS as never, id))
    expect(run.credits).toBe(route.credits)
    expect(run.payload).toMatchObject({ videoDuration: sec })
  })

  it("HappyHorse Edit: a size left on the node by another model is sent as 720p unless it is 1080p", async () => {
    clip.sec = 4
    expect((await runHold({ videoUrl: "https://cdn.test/clip.mp4", provider: "happyhorse-edit", resolution: "480p" })).payload.resolution).toBe("720p")
    expect((await runHold({ videoUrl: "https://cdn.test/clip.mp4", provider: "happyhorse-edit" })).payload.resolution).toBe("720p")
    const hd = await runHold({ videoUrl: "https://cdn.test/clip.mp4", provider: "happyhorse-edit", resolution: "1080p" })
    expect(hd.payload.resolution).toBe("1080p")
    expect(hd.id).toBe("happyhorse-edit:1080p:per-4s")
  })

  it("refuses what the route refuses, and touches no other model", async () => {
    clip.sec = 61
    expect(await stampVideoToVideoClipInput("video-to-video", { videoUrl: "https://cdn.test/clip.mp4", provider: "happyhorse-edit" })).toMatchObject({ code: "video_too_long" })
    clip.sec = "unreadable"
    expect(await stampVideoToVideoClipInput("video-to-video", { videoUrl: "https://cdn.test/clip.mp4", provider: "wan-videoedit" })).toMatchObject({ code: "video_unreadable" })
    const wan = { videoUrl: "https://cdn.test/clip.mp4", provider: "wan", resolution: "1080p" }
    expect(await stampVideoToVideoClipInput("video-to-video", wan)).toBeUndefined()
    expect(wan).toEqual({ videoUrl: "https://cdn.test/clip.mp4", provider: "wan", resolution: "1080p" })
    expect(videoToVideoReserveId("video-to-video", wan)).toBeUndefined()
    expect(await computeVideoToVideoClipCreditOverride("video-to-video", wan, "wan")).toBeUndefined()
  })
})
