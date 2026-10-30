/**
 * Which videos of a trend version get a web copy, and which web copy is
 * served (ee/lib/trends/web-copy-plan.ts, pure).
 */
import { describe, expect, it } from "vitest"
import type { TrendVersionData } from "../types.js"
import { currentWebCopy, hasCurrentWebCopy, publicWebCopy, webCopyTargets } from "../web-copy-plan.js"

const SRC = "https://cdn.test/trends/t/src.mov"
const DISPLAY = { videoUrl: "https://cdn.test/trends/t/display.mp4", posterUrl: "https://cdn.test/trends/t/d.png", width: 720, height: 1280, durationSec: 12 }
const EX = (n: number) => ({ videoUrl: `https://cdn.test/trends/t/ex${n}.mp4`, width: 720, height: 1280, durationSec: 12, slots: {}, sourceJobId: `job-${n}` })
const web = (from: string) => ({ videoUrl: `${from}.web.mp4`, sizeBytes: 7_000_000, madeFrom: from })
const data = (over: Partial<TrendVersionData> = {}): TrendVersionData => ({
  name: { en: "Neon" },
  source: { videoUrl: SRC, durationSec: 12, display: DISPLAY },
  previewStart: null,
  slots: [],
  references: [],
  examples: [EX(1), EX(2)],
  ...over,
})

describe("hasCurrentWebCopy / currentWebCopy / publicWebCopy", () => {
  it("a copy made from the video the entry shows now is served as webUrl / webSizeBytes", () => {
    const entry = { ...EX(1), web: web(EX(1).videoUrl) }
    expect(hasCurrentWebCopy(entry)).toBe(true)
    expect(currentWebCopy(entry)).toEqual(web(EX(1).videoUrl))
    expect(publicWebCopy(entry)).toEqual({ webUrl: `${EX(1).videoUrl}.web.mp4`, webSizeBytes: 7_000_000 })
  })

  it("none, or one made from a video since replaced, is not served", () => {
    expect(publicWebCopy(EX(1))).toEqual({})
    const stale = { ...EX(1), web: web("https://cdn.test/trends/t/before-upscale.mp4") }
    expect(hasCurrentWebCopy(stale)).toBe(false)
    expect(currentWebCopy(stale)).toBeUndefined()
    expect(publicWebCopy(stale)).toEqual({})
  })
})

describe("webCopyTargets", () => {
  it("the original (encoded from the uploaded clip, pinned to its display copy) first, then every example", () => {
    expect(webCopyTargets(data())).toEqual([
      { label: "original", madeFrom: DISPLAY.videoUrl, encodeFrom: SRC },
      { label: "example 1", madeFrom: EX(1).videoUrl, encodeFrom: EX(1).videoUrl },
      { label: "example 2", madeFrom: EX(2).videoUrl, encodeFrom: EX(2).videoUrl },
    ])
  })

  it("a video with a current copy is left out; one with a stale copy is made again", () => {
    const d = data({
      source: { videoUrl: SRC, durationSec: 12, display: { ...DISPLAY, web: web(DISPLAY.videoUrl) } },
      examples: [{ ...EX(1), web: web(EX(1).videoUrl) }, { ...EX(2), web: web("https://cdn.test/trends/t/old.mp4") }],
    })
    expect(webCopyTargets(d).map((t) => t.label)).toEqual(["example 2"])
  })

  it("a version that hides its original never copies its display copy (never served): its examples only", () => {
    expect(webCopyTargets(data({ hideOriginal: true })).map((t) => t.label)).toEqual(["example 1", "example 2"])
  })

  it("no display copy (or no source): the examples only; the same address is copied once", () => {
    expect(webCopyTargets(data({ source: { videoUrl: SRC, durationSec: 12 } })).map((t) => t.label)).toEqual(["example 1", "example 2"])
    expect(webCopyTargets(data({ source: null, examples: [EX(1), EX(1)] })).map((t) => t.label)).toEqual(["example 1"])
  })
})
