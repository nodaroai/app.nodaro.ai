// @test-units-by-name looks up only the video model credit rows it names
/**
 * Generate Video Pro on PixVerse V6 Max (admitted 2026-11-12 through the
 * catalog's `gvpWithoutReferences`): keyframes only, and every segment priced
 * at the audio the pro engine SENDS it — the request's `generateAudio`, on by
 * default — on the model's `:audio` or silent row. Kling 3.0 (which renders its
 * sound whatever `generateAudio` says) is charged its sound rows, and a model
 * whose price does not depend on audio keeps exactly its price.
 *
 * model_pricing lookups MISS, so `getModelCreditBaseCost` reads the real
 * STATIC_CREDIT_COSTS (as generate-video-pro-credits.test.ts does).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

import { computeGenerateVideoProPricing, computeGenerateVideoProContinuationPricing } from "../generate-video-pro-credits.js"
import { STATIC_CREDIT_COSTS, invalidateModelPricingCache } from "../credits.js"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { videoAudioPricedOn } from "@nodaro/shared/models"

const ID = "pixverse-v6-max"
const row = (sec: number, res: string, audio: boolean) => STATIC_CREDIT_COSTS[`${ID}:${sec}s:${res}${audio ? ":audio" : ""}`]!

beforeEach(() => {
  invalidateModelPricingCache()
})

describe("generate-video-pro × pixverse-v6-max", () => {
  const BASE = {
    provider: ID,
    resolution: "720p",
    durationSec: 23,
    segmentDurations: [10, 8, 6],
    renderMethod: "keyframes" as const,
    aspectRatio: "16:9",
  }

  it("prices each segment at its ladder row WITH audio when the request names none (the engine sends audio on)", async () => {
    const p = await computeGenerateVideoProPricing(BASE)
    expect(p.segmentCosts).toEqual([row(10, "720p", true), row(8, "720p", true), row(6, "720p", true)])
    expect(p.segmentCosts).toEqual([300, 240, 180])
    expect(p.renderMethod).toBe("keyframes")
    expect(p.endAnchors).toBe(false)
  })

  it("generateAudio true / false / unset bills the matching rows — the state the engine sends each segment", async () => {
    for (const generateAudio of [true, false, undefined]) {
      const p = await computeGenerateVideoProPricing({ ...BASE, ...(generateAudio === undefined ? {} : { generateAudio }) })
      // What the engine sends: the request's `generateAudio`, on unless false.
      const sent = generateAudio !== false
      // What the runner renders from that field, through the shared reader.
      expect(videoAudioPricedOn(ID, { generateAudio: sent })).toBe(sent)
      expect(p.segmentCosts, String(generateAudio)).toEqual([10, 8, 6].map((d) => row(d, "720p", sent)))
    }
    const off = await computeGenerateVideoProPricing({ ...BASE, generateAudio: false })
    expect(off.segmentCosts).toEqual([220, 180, 140])
  })

  it("the reserve is the fee + every segment + the anchors, at the audio it renders", async () => {
    const on = await computeGenerateVideoProPricing({ ...BASE, generateAudio: true })
    const off = await computeGenerateVideoProPricing({ ...BASE, generateAudio: false })
    const fee = STATIC_CREDIT_COSTS["generate-video-pro"]!
    expect(on.reserveBase).toBe(fee + 300 + 240 + 180 + (on.anchorReserve ?? 0))
    expect(off.reserveBase).toBe(fee + 220 + 180 + 140 + (off.anchorReserve ?? 0))
    expect(on.reserveBase - off.reserveBase).toBe(180)
  })

  it("renders and bills the pro engine's ladder: 540p and 360p run at 720p, 4K at 1080p", async () => {
    for (const [asked, billed] of [["540p", "720p"], ["360p", "720p"], ["720p", "720p"], ["1080p", "1080p"], ["4k", "1080p"]] as const) {
      const p = await computeGenerateVideoProPricing({ ...BASE, resolution: asked, generateAudio: true })
      expect(p.resolution, asked).toBe(billed)
      expect(p.segmentCosts, asked).toEqual([10, 8, 6].map((d) => row(d, billed, true)))
    }
  })

  it("a continuation re-renders its segments at the same audio rows", async () => {
    for (const generateAudio of [true, false, undefined]) {
      const p = await computeGenerateVideoProContinuationPricing({
        provider: ID,
        resolution: "720p",
        segmentDurations: [10, 8, 6],
        fromSegment: 2,
        renderMethod: "keyframes",
        ...(generateAudio === undefined ? {} : { generateAudio }),
      })
      expect(p.segmentCosts, String(generateAudio)).toEqual([10, 8, 6].map((d) => row(d, "720p", generateAudio !== false)))
    }
  })

  it("has no extend render: an extend request is refused before anything is priced", async () => {
    await expect(computeGenerateVideoProPricing({ ...BASE, renderMethod: "extend" })).rejects.toThrow(/keyframes/)
  })
})

describe("generate-video-pro × Kling (audio-priced, its switch reads only `sound`)", () => {
  // Not offered by the pro node, but the pro route takes any model an API call
  // names. A segment is handed `generateAudio` only, which Kling 3.0 does not
  // read: it renders its sound (its default), so it is charged its sound rows
  // whatever `generateAudio` says (generate-video-pro-charges-what-it-renders).
  it("kling-3.0 prices its `:audio` rows for generateAudio true / false / unset", async () => {
    const base = { provider: "kling-3.0", resolution: "720p", durationSec: 20, segmentDurations: [11, 10], renderMethod: "keyframes" as const, aspectRatio: "16:9" }
    const sound = (d: number) => STATIC_CREDIT_COSTS[buildVideoCreditModelIdentifier("kling-3.0", d, true, "image-to-video", undefined, "720p", false)]!
    for (const generateAudio of [true, false, undefined]) {
      const p = await computeGenerateVideoProPricing({ ...base, ...(generateAudio === undefined ? {} : { generateAudio }) })
      expect(p.segmentCosts, String(generateAudio)).toEqual([sound(11), sound(10)])
      expect(p.segmentCosts, String(generateAudio)).toEqual([STATIC_CREDIT_COSTS["kling-3.0:15s:audio"], STATIC_CREDIT_COSTS["kling-3.0:10s:audio"]])
    }
  })
})

describe("generate-video-pro × models whose price does not depend on audio: today's prices, whatever generateAudio says", () => {
  // Pinned literals (STATIC_CREDIT_COSTS, model_pricing misses), read before
  // the pro pricing began following each segment's rendered audio.
  const PINNED = [
    { provider: "seedance-2", resolution: "720p", renderMethod: "extend", reserveBase: 2388 },
    { provider: "seedance-2", resolution: "1080p", renderMethod: "keyframes", reserveBase: 6575 },
    { provider: "seedance-2-mini", resolution: "720p", renderMethod: "extend", reserveBase: 1244 },
    { provider: "seedance-2-mini", resolution: "480p", renderMethod: "keyframes", reserveBase: 794 },
    { provider: "minimax-h3", resolution: "768P", renderMethod: "extend", reserveBase: 1619 },
    { provider: "minimax-h3", resolution: "2K", renderMethod: "keyframes", reserveBase: 2482 },
    { provider: "kling-4", resolution: "1080p", renderMethod: "keyframes", reserveBase: 2700, segmentCosts: [2550] },
    { provider: "kling-4", resolution: "720p", renderMethod: "keyframes", reserveBase: 1860, segmentCosts: [1710] },
  ] as const

  for (const row of PINNED) {
    it(`${row.provider} ${row.resolution} ${row.renderMethod}`, async () => {
      for (const generateAudio of [true, false, undefined]) {
        const p = await computeGenerateVideoProPricing({
          provider: row.provider, resolution: row.resolution, durationSec: 24, renderMethod: row.renderMethod, aspectRatio: "16:9",
          ...(generateAudio === undefined ? {} : { generateAudio }),
        })
        expect(p.reserveBase, String(generateAudio)).toBe(row.reserveBase)
        expect(p.resolution, String(generateAudio)).toBe(row.resolution)
        if ("segmentCosts" in row) expect(p.segmentCosts, String(generateAudio)).toEqual([...row.segmentCosts])
      }
    })
  }

  it("continuations too (kling-4 keyframes, seedance-2 extend)", async () => {
    for (const generateAudio of [true, false, undefined]) {
      const audio = generateAudio === undefined ? {} : { generateAudio }
      const k4 = await computeGenerateVideoProContinuationPricing({ provider: "kling-4", resolution: "1080p", segmentDurations: [10, 8, 5], fromSegment: 1, renderMethod: "keyframes", ...audio })
      expect(k4.reserveBase, String(generateAudio)).toBe(2560)
      expect(k4.segmentCosts, String(generateAudio)).toEqual([1070, 850, 540])
      const s2 = await computeGenerateVideoProContinuationPricing({ provider: "seedance-2", resolution: "720p", segmentDurations: [10, 8, 5], fromSegment: 1, renderMethod: "extend", ...audio })
      expect(s2.reserveBase, String(generateAudio)).toBe(2188)
    }
  })

  it("the other models the pro node offered before PixVerse V6 Max keep their price too", async () => {
    for (const provider of ["vidu-q4", "wan-3"]) {
      const base = { provider, resolution: "1080p", durationSec: 23, segmentDurations: [10, 8, 6], renderMethod: "keyframes" as const, aspectRatio: "16:9" }
      const before = await computeGenerateVideoProPricing(base)
      for (const generateAudio of [true, false]) {
        const p = await computeGenerateVideoProPricing({ ...base, generateAudio })
        expect(p.reserveBase, `${provider} ${generateAudio}`).toBe(before.reserveBase)
      }
    }
  })
})
