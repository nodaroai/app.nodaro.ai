import { beforeEach, describe, expect, it, vi } from "vitest"

// The base is measured with the worker's own probe (`probeVideoOverlayBaseSource`): its video stream's length.
const probe = vi.hoisted(() => ({
  fn: (async () => ({ streamDurationSec: 10 })) as (url: string) => Promise<{ streamDurationSec: number }>,
  urls: [] as string[],
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeVideoOverlayBaseSource: async (url: string) => {
    probe.urls.push(url)
    return probe.fn(url)
  },
}))
const rows = vi.hoisted(() => ({ calls: [] as Array<[string, number]> }))
vi.mock("../credit-base-cost.js", () => ({
  unitRateBaseCredits: async (id: string, units: number) => {
    rows.calls.push([id, units])
    return units * 10
  },
}))

import {
  measureVideoOverlayBase,
  stampVideoOverlayLength,
  videoOverlayBaseCredits,
  videoOverlayReserveId,
  videoOverlayReserveUnits,
} from "../video-overlay-length.js"
import { videoOverlayRefusalAtLength, videoOverlayRefusalForCharge } from "../video-overlay-refusal.js"
import { expandVideoOverlayPresets } from "@nodaro/shared/video"

const BASE = "https://cdn.example/base.mp4"
const CLIP = "https://cdn.example/clip.mp4"
const IMG = "https://cdn.example/card.png"
const video = (over: Record<string, unknown> = {}) => ({ videoUrl: CLIP, start: 0, ...over })
const image = (over: Record<string, unknown> = {}) => ({ imageUrl: IMG, start: 0, ...over })

beforeEach(() => {
  probe.fn = async () => ({ streamDurationSec: 10 })
  probe.urls = []
  rows.calls = []
})

describe("measureVideoOverlayBase — the base of a run with a video layer, before anything is reserved", () => {
  it("a 10 s base is 2 units", async () => {
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toEqual({ ok: true, durationSec: 10, units: 2 })
    expect(probe.urls).toEqual([BASE])
  })

  it("reads the length the worker's probe reads (its video stream's) — the length the render follows", async () => {
    probe.fn = async () => ({ streamDurationSec: 59.9 })
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toEqual({ ok: true, durationSec: 59.9, units: 12 })
  })

  it("60 s is 12 units; 60.04 s (a whole-second cut of a 29.97 fps clip) is still 12", async () => {
    probe.fn = async () => ({ streamDurationSec: 60 })
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toMatchObject({ ok: true, units: 12 })
    probe.fn = async () => ({ streamDurationSec: 60.04 })
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toMatchObject({ ok: true, units: 12 })
  })

  it("61 s is refused: video_overlay_too_long", async () => {
    probe.fn = async () => ({ streamDurationSec: 61 })
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toEqual({
      ok: false,
      code: "video_overlay_too_long",
      message: "The base video is 61 seconds. A Video Overlay with a video layer takes a base of up to 60 seconds — trim it first.",
    })
  })

  it("a base that cannot be read is refused: invalid_media_duration", async () => {
    probe.fn = async () => {
      throw new Error("ffprobe: moov atom not found")
    }
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layers: [video()] })).toEqual({
      ok: false,
      code: "invalid_media_duration",
      message: "Could not read the base video. The file may be corrupted or an unsupported format.",
    })
  })

  it("a stack whose first video layer starts after the base ends is refused: video_overlay_starts_after_end", async () => {
    const r = await measureVideoOverlayBase({ videoUrl: BASE, layout: "stack-whole", layers: [image(), video({ start: 12, slot: 2 })] })
    expect(r).toEqual({ ok: false, code: "video_overlay_starts_after_end", message: "Layer 2: the stacked video starts at 12 s, after the video ends (10.00 s)" })
  })

  it("every layer starting after the base ends is refused the same way", async () => {
    const r = await measureVideoOverlayBase({ videoUrl: BASE, layers: [video({ start: 10 }), image({ start: 11 })] })
    expect(r).toEqual({ ok: false, code: "video_overlay_starts_after_end", message: "Every layer starts after the video ends (10.00 s)" })
  })

  it("a video layer past the end beside one that is not, outside a stack, is no refusal (it is skipped, as today)", async () => {
    expect(await measureVideoOverlayBase({ videoUrl: BASE, layout: "pip", layers: [video({ start: 12 }), image()] })).toMatchObject({ ok: true, units: 2 })
  })
})

describe("videoOverlayRefusalAtLength — the worker's own refusals, before anything is fetched", () => {
  it("names nothing for an image-only request at any length", () => {
    expect(videoOverlayRefusalAtLength({ layers: expandVideoOverlayPresets([image()]) }, 600)).toBeUndefined()
  })
  it("the cap applies only with a video layer", () => {
    expect(videoOverlayRefusalAtLength({ layers: expandVideoOverlayPresets([video()]) }, 61)).toMatchObject({ code: "video_overlay_too_long" })
  })
  it("a stack's first video layer is the lowest one in render order", () => {
    const layers = expandVideoOverlayPresets([video({ start: 0, zIndex: 5 }), video({ start: 20, zIndex: 1, slot: 2 })])
    expect(videoOverlayRefusalAtLength({ layout: "stack-filled", layers }, 10)).toMatchObject({ code: "video_overlay_starts_after_end", message: "Layer 2: the stacked video starts at 20 s, after the video ends (10.00 s)" })
  })
})

describe("stampVideoOverlayLength (the workflow run's twin of the route's preHandler)", () => {
  it("stamps the units a run with a video layer reserves, on the video row", async () => {
    const payload: Record<string, unknown> = { videoUrl: BASE, layers: [video()] }
    expect(await stampVideoOverlayLength("video-overlay", payload)).toBeUndefined()
    expect(payload.billedUnits).toBe(2)
    expect(videoOverlayReserveUnits("video-overlay", payload)).toBe(2)
    expect(videoOverlayReserveId("video-overlay", payload)).toBe("video-overlay:video")
  })

  it("returns the route's refusals", async () => {
    probe.fn = async () => ({ streamDurationSec: 61 })
    expect(await stampVideoOverlayLength("video-overlay", { videoUrl: BASE, layers: [video()] })).toMatchObject({ code: "video_overlay_too_long" })
    probe.fn = async () => {
      throw new Error("unreadable")
    }
    expect(await stampVideoOverlayLength("video-overlay", { videoUrl: BASE, layers: [video()] })).toMatchObject({ code: "invalid_media_duration" })
  })

  it("an image-only run is never measured, and keeps the flat row", async () => {
    const payload: Record<string, unknown> = { videoUrl: BASE, layers: [image()] }
    expect(await stampVideoOverlayLength("video-overlay", payload)).toBeUndefined()
    expect(probe.urls).toEqual([])
    expect(payload).not.toHaveProperty("billedUnits")
    expect(videoOverlayReserveUnits("video-overlay", payload)).toBeUndefined()
    expect(videoOverlayReserveId("video-overlay", payload)).toBeUndefined()
  })

  it("leaves every other job alone", async () => {
    const payload: Record<string, unknown> = { videoUrl: BASE, layers: [video()] }
    expect(await stampVideoOverlayLength("image-overlay", payload)).toBeUndefined()
    expect(payload).toEqual({ videoUrl: BASE, layers: [video()] })
    expect(videoOverlayReserveId("image-overlay", { billedUnits: 2 })).toBeUndefined()
  })
})

describe("videoOverlayBaseCredits", () => {
  it("is the video row × the units, through the shared row lookup (at least one unit)", async () => {
    expect(await videoOverlayBaseCredits(12)).toBe(120)
    expect(await videoOverlayBaseCredits(0)).toBe(10)
    expect(rows.calls).toEqual([["video-overlay:video", 12], ["video-overlay:video", 1]])
  })
})

describe("videoOverlayRefusalForCharge — the worker's check that the run was priced for the base it renders", () => {
  const videoLayers = () => expandVideoOverlayPresets([video()])
  it("a base no longer than it measured when priced passes", () => {
    expect(videoOverlayRefusalForCharge(videoLayers(), 2, 10)).toBeUndefined()
    expect(videoOverlayRefusalForCharge(videoLayers(), 12, 4)).toBeUndefined()
  })
  it("a re-measure up to half a second longer is the same file: billed for 10 s, downloaded at 10.4 s renders; 10.6 s is refused", () => {
    expect(videoOverlayRefusalForCharge(videoLayers(), 2, 10.4)).toBeUndefined()
    expect(videoOverlayRefusalForCharge(videoLayers(), 2, 10.6)).toEqual({
      code: "video_overlay_base_changed",
      message: "The base video is 11 seconds, longer than the 10 seconds this run was priced for — run it again",
    })
    // A very short base never reads as "not known" (the cap) after the slack.
    expect(videoOverlayRefusalForCharge(videoLayers(), 1, 0.3)).toBeUndefined()
  })

  it("a base longer than the units charged is refused (a link that served 5 s to the price probe and 60 s to the render)", () => {
    expect(videoOverlayRefusalForCharge(videoLayers(), 1, 60)).toEqual({
      code: "video_overlay_base_changed",
      message: "The base video is 60 seconds, longer than the 5 seconds this run was priced for — run it again",
    })
  })
  it("a run with a video layer that carries no priced units is refused", () => {
    expect(videoOverlayRefusalForCharge(videoLayers(), undefined, 5)).toEqual({
      code: "video_overlay_base_changed",
      message: "This run was not priced for a video layer — run it again",
    })
    expect(videoOverlayRefusalForCharge(videoLayers(), 0, 5)).toMatchObject({ code: "video_overlay_base_changed" })
  })
  it("an image-only run is never checked", () => {
    expect(videoOverlayRefusalForCharge(expandVideoOverlayPresets([image()]), undefined, 600)).toBeUndefined()
  })
})
