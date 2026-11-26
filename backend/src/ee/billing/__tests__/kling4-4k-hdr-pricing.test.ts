// @test-units-by-name looks up only the kling-4 / kling-4-keyframes / kling-4-hdr credit rows it names
import { describe, it, expect, vi, beforeEach } from "vitest"

// ffprobe is stubbed per URL: the settlement tests decide what the delivered
// clip and the reference clips measure.
const probe = vi.hoisted(() => ({
  durations: new Map<string, number>(),
  probeMediaDuration: vi.fn(async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))
// Rows read DB-first at run time: here no `model_pricing` row, so the static
// table answers (what the seed migration writes).
vi.mock("../../../lib/supabase.js", () => {
  const empty = { data: null, error: { message: "no row" } }
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, key) => (key === "then" ? (resolve: (v: unknown) => void) => resolve(empty) : () => chain),
  })
  return { supabase: { from: () => chain, rpc: () => chain } }
})

import { buildVideoCreditModelIdentifier, videoHdrAddonCreditId } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { seedance2RefVideoBaseCredits, seedance2RefVideoBaseCreditsFromDurations } from "../seedance2-ref-video-credits.js"
import { measureSeedance2Settle } from "../../../lib/seedance2-ref-video-settle.js"
import { videoHdrAddonBaseCredits } from "../../../lib/video-hdr-addon.js"
import { seedance2RefVideoQuote } from "../seedance2-ref-video-quote.js"

/**
 * Kling 4.0 at 4K and its HDR add-on, as approved (decided 2026-11-22): base
 * credits = the provider's credits per second × seconds × 2.5, rounded up to
 * the next 10. 4K 99/s on both ids, with a video input 59/s on input + output
 * seconds; HDR its own line on the OUTPUT seconds only, 8.5/s at 1080p and
 * 14/s at 4K. Migration 714 seeds the same rows (static-costs-match-migrations).
 */
const ladder = (perSec: number, sec: number) => Math.ceil((perSec * sec * 2.5) / 10 - 1e-9) * 10
const DURATIONS = Array.from({ length: 28 }, (_, i) => i + 3)

describe("Kling 4.0 4K rows", () => {
  it("every 4K length on both ids follows the ladder rule", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      for (const d of DURATIONS) expect(STATIC_CREDIT_COSTS[`${id}:${d}s:4k`], `${id}:${d}s:4k`).toBe(ladder(99, d))
    }
    for (const d of DURATIONS) expect(STATIC_CREDIT_COSTS[`kling-4:${d}s:4k-ref`], `kling-4:${d}s:4k-ref`).toBe(ladder(59, d))
    expect(STATIC_CREDIT_COSTS["kling-4-keyframes:8s:4k-ref"]).toBeUndefined()
  })

  it("matches the approved figures: 3 s 750, 5 s 1,240, 10 s 2,480, 30 s 7,430; the 8 s -ref anchor 1,180", () => {
    expect([3, 5, 10, 30].map((d) => STATIC_CREDIT_COSTS[`kling-4:${d}s:4k`])).toEqual([750, 1240, 2480, 7430])
    expect([3, 5, 10, 30].map((d) => STATIC_CREDIT_COSTS[`kling-4-keyframes:${d}s:4k`])).toEqual([750, 1240, 2480, 7430])
    expect(STATIC_CREDIT_COSTS["kling-4:8s:4k-ref"]).toBe(1180)
  })

  it("a 4K run with a reference video bills 147.5 per second of output + max(output, input)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "4k", outputDurationSec: 5, inputVideoDurationSec: 3 })).toBe(Math.ceil(147.5 * 10))
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "4k", outputDurationSec: 10, inputVideoDurationSec: 15 })).toBe(Math.ceil(147.5 * 25))
    expect(buildVideoCreditModelIdentifier("kling-4", 10, undefined, "image-to-video", undefined, "4k", true)).toBe("kling-4:10s:4k-ref")
  })
})

describe("the HDR add-on rows", () => {
  it("every length at 1080p and 4K follows the ladder rule on its own rate", () => {
    for (const d of DURATIONS) {
      expect(STATIC_CREDIT_COSTS[`kling-4-hdr:${d}s:1080p`], `${d}s 1080p`).toBe(ladder(8.5, d))
      expect(STATIC_CREDIT_COSTS[`kling-4-hdr:${d}s:4k`], `${d}s 4k`).toBe(ladder(14, d))
    }
    expect(Object.keys(STATIC_CREDIT_COSTS).some((k) => k.startsWith("kling-4-hdr:") && (k.endsWith(":720p") || k.endsWith("-ref")))).toBe(false)
  })

  it("matches the approved figures: 1080p +70 / +110 / +220 / +640, 4K +110 / +180 / +350 / +1,050 for 3 / 5 / 10 / 30 s", () => {
    expect([3, 5, 10, 30].map((d) => STATIC_CREDIT_COSTS[`kling-4-hdr:${d}s:1080p`])).toEqual([70, 110, 220, 640])
    expect([3, 5, 10, 30].map((d) => STATIC_CREDIT_COSTS[`kling-4-hdr:${d}s:4k`])).toEqual([110, 180, 350, 1050])
  })

  it("every add-on id the builder can emit is priced", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      for (const d of [undefined, 1, ...DURATIONS, 31]) {
        for (const r of ["1080p", "1080P", "4k", "4K"]) {
          const credit = videoHdrAddonCreditId(id, d, r, "hdr")!
          expect(STATIC_CREDIT_COSTS[credit], credit).toBeTypeOf("number")
        }
      }
    }
  })

  it("videoHdrAddonBaseCredits reads the add-on's row, and 0 on an SDR run, at 720p, or on Flash", async () => {
    await expect(videoHdrAddonBaseCredits({ provider: "kling-4", duration: 5, resolution: "1080p", dynamicRange: "hdr" })).resolves.toBe(110)
    await expect(videoHdrAddonBaseCredits({ provider: "kling-4-keyframes", duration: 30, resolution: "4k", dynamicRange: "hdr" })).resolves.toBe(1050)
    await expect(videoHdrAddonBaseCredits({ provider: "kling-4", duration: 5, resolution: "1080p", dynamicRange: "sdr" })).resolves.toBe(0)
    await expect(videoHdrAddonBaseCredits({ provider: "kling-4", duration: 5, resolution: "720p", dynamicRange: "hdr" })).resolves.toBe(0)
    await expect(videoHdrAddonBaseCredits({ provider: "kling-4-flash", duration: 5, resolution: "720p", dynamicRange: "hdr" })).resolves.toBe(0)
  })
})

describe("an HDR run with a reference video: the add-on rides beside the -ref base and the settle keeps it", () => {
  const OUT = "https://kie.example/out.mp4"
  const REF = "https://r2.example.com/videos/ref.mp4"
  beforeEach(() => {
    probe.durations.clear()
    probe.probeMediaDuration.mockClear()
  })

  it("a long input clip moves the -ref base, never the add-on", async () => {
    const hdr = await videoHdrAddonBaseCredits({ provider: "kling-4", duration: 5, resolution: "1080p", dynamicRange: "hdr" })
    const short = seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "1080p", outputDurationSec: 5, requestedDuration: 5, referenceTaskType: undefined, durationsSec: [3] })
    const long = seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "1080p", outputDurationSec: 5, requestedDuration: 5, referenceTaskType: undefined, durationsSec: [20] })
    expect(long).toBeGreaterThan(short)
    expect(hdr).toBe(110)
  })

  it("the settle commits the measured -ref base plus the add-on, at both HDR sizes", async () => {
    probe.durations.set(OUT, 5.04)
    for (const [resolution, perSec, addon] of [["1080p", 63.75, 110], ["4k", 147.5, 180]] as const) {
      const settled = await measureSeedance2Settle({
        provider: "kling-4", resolution, outputUrl: OUT, referenceVideoUrls: [REF], refVideoDurationsSec: [12],
        characterReferences: undefined, duration: 5, referenceTaskType: undefined, dynamicRange: "hdr",
      })
      // 5 s out + 12 s in bills 17 s on the -ref rate; the add-on on the 5 output seconds.
      expect(settled.baseCredits, resolution).toBe(Math.ceil(perSec * 17) + addon)
    }
  })

  it("the editor's reference-video quote of an HDR run equals its hold: 5 s 1080p HDR with a 12 s clip = 1,314 at the charged price", async () => {
    const hdrAddonBase = await videoHdrAddonBaseCredits({ provider: "kling-4", duration: 5, resolution: "1080p", dynamicRange: "hdr" })
    const charge = (_id: string, base: number) => Math.ceil(base * 1.1)
    const quote = seedance2RefVideoQuote({ provider: "kling-4", resolution: "1080p", duration: 5, referenceTaskType: undefined, durationsSec: [12], unknownClips: 0, hdrAddonBase, charge })
    expect(quote).toEqual({ credits: 1314, min: 1314, exact: true })
    // The hold the route reserves: the measured -ref base plus the add-on, marked up once.
    const hold = charge("kling-4:5s:1080p-ref", seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "1080p", outputDurationSec: 5, requestedDuration: 5, referenceTaskType: undefined, durationsSec: [12] }) + hdrAddonBase)
    expect(quote.credits).toBe(hold)
  })

  it("an SDR reference run settles exactly as before (no add-on)", async () => {
    probe.durations.set(OUT, 5.04)
    const settled = await measureSeedance2Settle({
      provider: "kling-4", resolution: "1080p", outputUrl: OUT, referenceVideoUrls: [REF], refVideoDurationsSec: [12],
      characterReferences: undefined, duration: 5, referenceTaskType: undefined, dynamicRange: undefined,
    })
    expect(settled.baseCredits).toBe(Math.ceil(63.75 * 17))
  })
})

describe("Kling 4.0 Flash is unchanged", () => {
  it("has no 4K or HDR rows, and 4k still bills its 720p row", () => {
    expect(Object.keys(STATIC_CREDIT_COSTS).some((k) => k.startsWith("kling-4-flash:") && k.includes("4k"))).toBe(false)
    expect(buildVideoCreditModelIdentifier("kling-4-flash", 5, undefined, "image-to-video", undefined, "4k", true)).toBe("kling-4-flash:5s:720p-ref")
  })
})
