// @test-units-by-name prices the node types it names (upload-video, video-depth)
import { describe, it, expect } from "vitest"
import { VIDEO_DEPTH_LIMITS, videoDepthCreditId } from "@nodaro/shared/media"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, CreditsService } from "../credits.js"

/**
 * Video Depth Anything (fal) is charged 20 credits per second of the clip,
 * rounded up to whole seconds (decided 2026-11-03): fal bills the model per
 * second of video with no minimum (`providers/fal/pricing.ts`), which is 20
 * base credits a second at `CREDIT_BASE_USD`. Every surface picks the row
 * through `videoDepthCreditId` — the route's guard and reservation, the
 * workflow run's stamp and reservation, the workflow estimate (a Nodaro Motion
 * quote included), the editor's badge and estimate — so the price of a length
 * is the row it names. The bare id stays the 300 s ceiling.
 */

const FAL = "video-depth-anything"
const priceOf = (sec: number | null | undefined) => STATIC_CREDIT_COSTS[videoDepthCreditId(FAL, sec)]

describe("Video Depth Anything: 20 credits per second of the clip, rounded up", () => {
  it.each([
    [4, 80],
    [9, 180],
    [9.2, 200],
    [15, 300],
    [30, 600],
    [300, 6000],
  ])("a %s s clip costs %i", (sec, credits) => {
    expect(priceOf(sec)).toBe(credits)
  })

  it("a clip under one second pays for one second", () => {
    expect(priceOf(0.4)).toBe(20)
  })

  it("a length past 300 s, or none known, is priced at the 300 s ceiling, as today (such a clip is refused before anything is reserved)", () => {
    expect(priceOf(300.5)).toBe(6000)
    expect(priceOf(900)).toBe(6000)
    expect(priceOf(undefined)).toBe(6000)
    expect(STATIC_CREDIT_COSTS[FAL]).toBe(6000)
  })

  it("every second the provider accepts has its own row at 20 credits a second, and the family holds no other row", () => {
    const rows = Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith(`${FAL}:`))
    expect(rows).toHaveLength(VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS)
    for (let n = 1; n <= VIDEO_DEPTH_LIMITS.FAL_MAX_SECONDS; n++) {
      expect(STATIC_CREDIT_COSTS[`${FAL}:${n}s`], `${n}s`).toBe(20 * n)
    }
  })

  it("at 15, 30, 60, 120 and 300 s the price is the one the length buckets charged", () => {
    expect([15, 30, 60, 120, 300].map((sec) => priceOf(sec))).toEqual([300, 600, 1200, 2400, 6000])
  })

  // MCP `list_models` serves each catalog row at its CHARGED price and its note
  // as written (`chargedPricing`, lib/mcp/tools/models.ts), so a base figure in
  // a note would sit beside a different served one (20 next to 22 on Cloud).
  it("the catalog's Video Depth Anything notes state no credit figure: the row's own credits are the price served", () => {
    const notes = MODEL_CATALOG[FAL]!.pricing.map((row) => row.note ?? "")
    expect(notes.some((note) => /per second/i.test(note)), "a note still says how the rows are priced").toBe(true)
    for (const note of notes) expect(note).not.toMatch(/\d+\s*credits?\b/i)
  })

})

/**
 * Depth Anything per frame (Replicate) follows the same rule at 2 credits a
 * second (decided 2026-11-04), up to its 80 s limit. The worker sets no metered
 * cost for it either: the reserved row is the charge.
 */
const FRAMES = "depth-anything-frames"
const framesPriceOf = (sec: number | null | undefined) => STATIC_CREDIT_COSTS[videoDepthCreditId(FRAMES, sec)]

describe("Depth Anything per frame: 2 credits per second of the clip, rounded up", () => {
  it.each([
    [4, 8],
    [4.1, 10],
    [15, 30],
    [30, 60],
    [60, 120],
    [80, 160],
  ])("a %s s clip costs %i", (sec, credits) => {
    expect(framesPriceOf(sec)).toBe(credits)
  })

  it("a clip under one second pays for one second", () => {
    expect(framesPriceOf(0.4)).toBe(2)
  })

  it("a length past 80 s, or none known, is priced at the 80 s row (such a clip is refused before anything is reserved)", () => {
    expect(framesPriceOf(80.5)).toBe(160)
    expect(framesPriceOf(900)).toBe(160)
    expect(framesPriceOf(undefined)).toBe(160)
  })

  it("every second the provider accepts has its own row at 2 credits a second", () => {
    for (let n = 1; n <= VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS; n++) {
      expect(STATIC_CREDIT_COSTS[`${FRAMES}:${n}s`], `${n}s`).toBe(2 * n)
    }
  })

  it("the bare row is the price of the longest clip it accepts", () => {
    expect(STATIC_CREDIT_COSTS[FRAMES]).toBe(160)
    expect(STATIC_CREDIT_COSTS[FRAMES]).toBe(STATIC_CREDIT_COSTS[`${FRAMES}:${VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS}s`])
    expect(MODEL_CATALOG[FRAMES]!.pricing[0]).toMatchObject({ identifier: FRAMES, credits: 160 })
  })

  it("the only other rows are the ones no run reaches, at the values migration 502 seeded", () => {
    const others = Object.entries(STATIC_CREDIT_COSTS).filter(([id]) =>
      id.startsWith(`${FRAMES}:`) && Number(id.slice(FRAMES.length + 1, -1)) > VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS,
    )
    expect(Object.fromEntries(others)).toEqual({ [`${FRAMES}:120s`]: 240, [`${FRAMES}:300s`]: 600 })
    expect(Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith(`${FRAMES}:`))).toHaveLength(VIDEO_DEPTH_LIMITS.REPLICATE_MAX_SECONDS + 2)
  })

  it("at 15, 30 and 60 s the price is the one the length buckets charged", () => {
    expect([15, 30, 60].map((sec) => framesPriceOf(sec))).toEqual([30, 60, 120])
  })

  it("the catalog's notes state no credit figure, and no catalog row is one a run cannot reach beyond the bare id", () => {
    const pricing = MODEL_CATALOG[FRAMES]!.pricing
    expect(pricing.some((row) => /per second/i.test(row.note ?? ""))).toBe(true)
    for (const row of pricing) {
      expect(row.note ?? "").not.toMatch(/\d+\s*credits?\b/i)
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
    expect(pricing.map((row) => row.identifier)).toEqual([FRAMES, `${FRAMES}:1s`, `${FRAMES}:15s`, `${FRAMES}:60s`, `${FRAMES}:80s`])
  })
})

describe("the workflow estimate prices a Video Depth node per second of its clip", () => {
  // The shape a Nodaro Motion quote asks for: an upload that declares the
  // clip's length, wired into the Video Depth node's `video` input.
  const clip = (duration: number) => ({ id: "clip", type: "upload-video", data: { url: "https://cdn.example/clip.mp4", duration } })
  const depth = { id: "depth", type: "video-depth", data: { provider: FAL, modelSize: "large", colormap: "grayscale" } }
  const wire = [{ source: "clip", target: "depth", targetHandle: "video" }]
  const depthPart = (duration: number) =>
    CreditsService.estimateWorkflowBaseCredits([clip(duration), depth], wire) -
    CreditsService.estimateWorkflowBaseCredits([clip(duration)], [])

  it.each([
    [9, 180],
    [9.2, 200],
    [4, 80],
    [0.4, 20],
    [300, 6000],
    [301, 6000],
  ])("a %s s clip is quoted %i", (duration, credits) => {
    expect(depthPart(duration)).toBe(credits)
  })

  const framesPart = (duration: number) =>
    CreditsService.estimateWorkflowBaseCredits([clip(duration), { ...depth, data: { ...depth.data, provider: FRAMES } }], wire) -
    CreditsService.estimateWorkflowBaseCredits([clip(duration)], [])

  it.each([
    [4, 8],
    [4.1, 10],
    [15, 30],
    [0.4, 2],
    [80, 160],
    [81, 160],
  ])("on Depth Anything per frame, a %s s clip is quoted %i", (duration, credits) => {
    expect(framesPart(duration)).toBe(credits)
  })
})
