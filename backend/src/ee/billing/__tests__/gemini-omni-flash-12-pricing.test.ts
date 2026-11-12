// @test-units-by-name looks up only the gemini-omni-flash-1-2 credit rows it names
import { describe, it, expect, vi, beforeEach } from "vitest"

// ffprobe is stubbed per URL: the settlement tests decide what the delivered clip measures.
const probe = vi.hoisted(() => ({
  durations: new Map<string, number | Error>(),
  probeMediaDuration: vi.fn(async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    if (d instanceof Error) throw d
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { billsReferenceVideoSeconds, isGeminiOmniProvider, videoProviderFoldsLoneEndFrame, videoSourceTrimMaxSec } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import {
  billedRefVideoSeconds,
  seedance2RefVideoActualBaseCredits,
  seedance2RefVideoActualSeconds,
  seedance2RefVideoBaseCreditsFromDurations,
  seedance2RefVideoExpectedBaseCredits,
} from "../seedance2-ref-video-credits.js"
import { FREE_TIER_RESTRICTIONS } from "../stripe-config.js"

/**
 * Gemini Omni Flash 1.2 — one per-second ladder, from KIE's published rates
 * (kie.ai/gemini-omni-1-2-flash): 4 / 9 / 10 / 22 KIE cr/s at 360p / 720p /
 * 1080p / 4K. Base credits = KIE cr × 2.5, rounded up to the next 10. Migration
 * 612 seeds the same rows (static-costs-match-migrations.test.ts).
 */
const ID = "gemini-omni-flash-1-2"
const KIE_PER_SEC = { "360p": 4, "720p": 9, "1080p": 10, "4k": 22 } as const
const DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)
const ladder = (kiePerSec: number, sec: number) => Math.ceil((kiePerSec * sec * 2.5) / 10) * 10

const edit = (resolution: string, durationsSec: number[], videoTrim?: { start?: number; end?: number }) =>
  seedance2RefVideoBaseCreditsFromDurations({ provider: ID, resolution, outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec, videoTrim })

describe("gemini-omni-flash-1-2 static credits", () => {
  it("prices every (duration, resolution) row by the ladder rule", () => {
    for (const [res, perSec] of Object.entries(KIE_PER_SEC)) {
      for (const d of DURATIONS) expect(STATIC_CREDIT_COSTS[`${ID}:${d}s:${res}`], `${d}s ${res}`).toBe(ladder(perSec, d))
    }
  })

  it("the bare id is the 8s 720p default render", () => {
    expect(STATIC_CREDIT_COSTS[ID]).toBe(STATIC_CREDIT_COSTS[`${ID}:8s:720p`])
    expect(MODEL_CATALOG[ID]?.defaultDuration).toBe(8)
  })

  it("every catalog row matches the static table", () => {
    for (const row of MODEL_CATALOG[ID]?.pricing ?? []) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
  })

  it("closes every 4K row to the free tier, and only those", () => {
    const blocked = FREE_TIER_RESTRICTIONS.blockedModels as readonly string[]
    for (const d of DURATIONS) {
      expect(blocked).toContain(`${ID}:${d}s:4k`)
      expect(blocked).not.toContain(`${ID}:${d}s:1080p`)
    }
  })
})

describe("gemini-omni-flash-1-2 credit identifier", () => {
  const id = (d: number | undefined, res: string | undefined, hasVideoRef = false) =>
    buildVideoCreditModelIdentifier(ID, d, undefined, undefined, undefined, res, hasVideoRef)

  it("builds the per-second composite, unlike the per-clip Omni SKUs", () => {
    expect(id(5, "1080p")).toBe(`${ID}:5s:1080p`)
    expect(id(15, "4k")).toBe(`${ID}:15s:4k`)
    expect(id(3, "360p")).toBe(`${ID}:3s:360p`)
    expect(buildVideoCreditModelIdentifier("gemini-omni-flash", 8, undefined, undefined, undefined, "720p")).toBe("gemini-omni-flash:8")
  })

  it("an omitted or off-list resolution prices the 720p render, never the 360p row", () => {
    expect(id(8, undefined)).toBe(`${ID}:8s:720p`)
    expect(id(8, "2k")).toBe(`${ID}:8s:720p`)
  })

  it("an omitted duration prices the 8s default", () => {
    expect(id(undefined, "720p")).toBe(`${ID}:8s:720p`)
  })

  it("a source video adds no -ref rate", () => {
    expect(id(8, "720p", true)).toBe(`${ID}:8s:720p`)
  })

  it("is in the Omni family and bills its source clip", () => {
    expect(isGeminiOmniProvider(ID)).toBe(true)
    expect(billsReferenceVideoSeconds(ID)).toBe(true)
    expect(videoProviderFoldsLoneEndFrame(ID)).toBe(true)
    expect(videoSourceTrimMaxSec(ID)).toBe(15)
    expect(videoSourceTrimMaxSec("gemini-omni-flash")).toBe(10)
  })
})

describe("gemini-omni-flash-1-2 video edit", () => {
  beforeEach(() => probe.durations.clear())

  it("reserves the clip's length on the ladder, whatever the node's duration says", () => {
    expect(edit("720p", [5])).toBe(STATIC_CREDIT_COSTS[`${ID}:5s:720p`])
    expect(edit("4k", [12])).toBe(STATIC_CREDIT_COSTS[`${ID}:12s:4k`])
  })

  it("rounds a clip between rungs up", () => {
    expect(edit("720p", [5.4])).toBe(STATIC_CREDIT_COSTS[`${ID}:6s:720p`])
  })

  it("a clip over the limit bills the first 15 s it sends", () => {
    expect(edit("1080p", [60])).toBe(STATIC_CREDIT_COSTS[`${ID}:15s:1080p`])
  })

  it("an unmeasurable clip holds the worst case", () => {
    expect(edit("720p", [Number.NaN])).toBe(STATIC_CREDIT_COSTS[`${ID}:15s:720p`])
  })

  it("the node's trim decides what is billed", () => {
    expect(edit("720p", [60], { start: 10, end: 16 })).toBe(STATIC_CREDIT_COSTS[`${ID}:6s:720p`])
    expect(edit("720p", [Number.NaN], { start: 2, end: 6 })).toBe(STATIC_CREDIT_COSTS[`${ID}:4s:720p`])
  })

  it("a clip under the ladder bills its first rung", () => {
    expect(edit("720p", [1.5])).toBe(STATIC_CREDIT_COSTS[`${ID}:3s:720p`])
  })

  it("bills the output alone", () => {
    expect(billedRefVideoSeconds(ID, 8, 8)).toBe(8)
  })

  it("settles on the delivered clip", async () => {
    probe.durations.set("out", 8.04)
    const run = { provider: ID, resolution: "720p", outputUrl: "out", referenceVideoUrls: ["clip"], durationsSec: [8], requestedDuration: 5, referenceTaskType: undefined }
    const seconds = await seedance2RefVideoActualSeconds(run)
    expect(seconds.chargedOutputSec).toBeCloseTo(8.04)
    expect(await seedance2RefVideoActualBaseCredits(run, seconds)).toBe(STATIC_CREDIT_COSTS[`${ID}:8s:720p`])
  })

  it("states the clip's length as the expected cost", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ provider: ID, resolution: "720p", outputDurationSec: 8, autoDuration: false, durationsSec: [5] }))
      .toBe(STATIC_CREDIT_COSTS[`${ID}:5s:720p`])
  })

  it("leaves Kling 4.0 and Seedance on their own rules", () => {
    expect(billedRefVideoSeconds("kling-4", 10, 5)).toBe(20)
    expect(billedRefVideoSeconds("seedance-2-5", 10, 5)).toBe(15)
  })
})
