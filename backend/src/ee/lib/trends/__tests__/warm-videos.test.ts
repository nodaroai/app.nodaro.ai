/**
 * warm-videos.ts — what a published trend version warms on the CDN: exactly
 * the videos the public catalog shows (the shown original and every listed
 * example, each once, with its width), never the source clip, and never the
 * display copy of a version that hides its original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TrendVersionData } from "../types.js"

const warmVideoCopies = vi.hoisted(() => vi.fn())
vi.mock("../../../../lib/warm-video-copies.js", () => ({ warmVideoCopies }))

import { trendVersionVideos, warmTrendVersionVideos } from "../warm-videos.js"

const CDN = "https://cdn.nodaro.ai/trends/t1"
const DISPLAY = { videoUrl: `${CDN}/display.mp4`, posterUrl: `${CDN}/display.png`, width: 720, height: 1280, durationSec: 12 }
const example = (n: number, width = 1080) => ({
  videoUrl: `${CDN}/ex${n}.mp4`,
  width,
  height: 1920,
  durationSec: 12,
  slots: {},
  sourceJobId: `00000000-0000-4000-8000-00000000000${n}`,
})

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Neon" },
    source: { videoUrl: `${CDN}/src.mp4`, durationSec: 12, width: 2568, height: 4566, display: DISPLAY },
    previewStart: 0,
    slots: [],
    references: [],
    examples: [],
    ...over,
  }
}

beforeEach(() => {
  warmVideoCopies.mockReset()
})

describe("trendVersionVideos", () => {
  it("the display copy and every example, with their widths; never the source clip", () => {
    expect(trendVersionVideos(data({ examples: [example(1), example(2, 480)] }))).toEqual([
      { videoUrl: `${CDN}/display.mp4`, width: 720 },
      { videoUrl: `${CDN}/ex1.mp4`, width: 1080 },
      { videoUrl: `${CDN}/ex2.mp4`, width: 480 },
    ])
  })

  it("a version with only its original warms the display copy (the card's cover)", () => {
    expect(trendVersionVideos(data())).toEqual([{ videoUrl: `${CDN}/display.mp4`, width: 720 }])
  })

  it("a version that hides its original: Example 1 as the original, then the rest; never the display copy", () => {
    const out = trendVersionVideos(data({ hideOriginal: true, examples: [example(1), example(2)] }))
    expect(out).toEqual([
      { videoUrl: `${CDN}/ex1.mp4`, width: 1080 },
      { videoUrl: `${CDN}/ex2.mp4`, width: 1080 },
    ])
    expect(out.map((v) => v.videoUrl)).not.toContain(DISPLAY.videoUrl)
  })

  it("an address listed twice is warmed once", () => {
    expect(trendVersionVideos(data({ examples: [example(1), example(1)] }))).toHaveLength(2)
  })
})

describe("warmTrendVersionVideos", () => {
  it("hands each video and its width to the warmer", () => {
    warmTrendVersionVideos(data({ examples: [example(1)] }))
    expect(warmVideoCopies.mock.calls).toEqual([
      [`${CDN}/display.mp4`, 720],
      [`${CDN}/ex1.mp4`, 1080],
    ])
  })

  it("never throws, even when the warmer does", () => {
    warmVideoCopies.mockImplementation(() => {
      throw new Error("boom")
    })
    expect(() => warmTrendVersionVideos(data())).not.toThrow()
  })
})
