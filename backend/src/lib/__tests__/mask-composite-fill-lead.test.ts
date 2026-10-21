/**
 * Mask Composite's leading video — the input the result follows, and so the
 * one a run is measured, charged and quoted on: the foreground for the video
 * fill, the background for pixelate / blur. One rule (`maskCompositeLeadHandle`)
 * read by the route / workflow run (`maskCompositeLeadOf`), the run estimates
 * (`maskCompositeLeadSec`) and the length walks (`keptLengthWire`).
 */
import { describe, it, expect } from "vitest"
import { maskCompositeEffectiveAudioSource, maskCompositeLeadHandle } from "@nodaro/shared/media"
import { keptLengthWire, maskCompositeLeadSec } from "@nodaro/render-rules"
import { maskCompositeLeadOf } from "../mask-composite-length.js"

const URLS = { foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4" }

describe("maskCompositeLeadOf (route preHandler + workflow run)", () => {
  it("measures the foreground for the video fill, and for a missing or unknown fill (the parse's default)", () => {
    expect(maskCompositeLeadOf(URLS)).toEqual({ lead: "foreground", url: URLS.foregroundUrl })
    expect(maskCompositeLeadOf({ ...URLS, fill: "video" })).toEqual({ lead: "foreground", url: URLS.foregroundUrl })
    expect(maskCompositeLeadOf({ ...URLS, fill: "PIXELATE" })).toEqual({ lead: "foreground", url: URLS.foregroundUrl })
  })
  it("measures the background for pixelate / blur, even when a foreground is sent", () => {
    expect(maskCompositeLeadOf({ ...URLS, fill: "pixelate" })).toEqual({ lead: "background", url: URLS.backgroundUrl })
    expect(maskCompositeLeadOf({ backgroundUrl: URLS.backgroundUrl, fill: "blur" })).toEqual({ lead: "background", url: URLS.backgroundUrl })
  })
})

describe("the lead wire in the estimates and length walks", () => {
  const edges = [
    { source: "fg", target: "x", targetHandle: "video" },
    { source: "bg", target: "x", targetHandle: "background-video" },
    { source: "m", target: "x", targetHandle: "mask-video" },
  ]
  const nodes = [
    { id: "fg", type: "upload-video", data: {} },
    { id: "bg", type: "upload-video", data: {} },
    { id: "m", type: "upload-video", data: {} },
  ]
  const secs = [20, 70, 20]

  it("maskCompositeLeadHandle: video → the `video` handle, pixelate / blur → `background-video`", () => {
    expect(maskCompositeLeadHandle({})).toBe("video")
    expect(maskCompositeLeadHandle({ fill: "pixelate" })).toBe("background-video")
    expect(maskCompositeLeadHandle({ fill: "blur" })).toBe("background-video")
  })

  it("maskCompositeLeadSec quotes the foreground's length, or the background's with pixelate / blur", () => {
    expect(maskCompositeLeadSec({}, edges, secs)).toBe(20)
    expect(maskCompositeLeadSec({ fill: "pixelate" }, edges, secs)).toBe(70)
    expect(maskCompositeLeadSec({ fill: "blur" }, edges, [20, undefined, 20])).toBeUndefined()
  })

  it("keptLengthWire follows the background wire for pixelate / blur, the foreground otherwise", () => {
    const x = (data: Record<string, unknown>) => ({ id: "x", type: "mask-composite", data })
    expect(keptLengthWire(x({}), [x({}), ...nodes], edges)?.source).toBe("fg")
    expect(keptLengthWire(x({ fill: "pixelate" }), [x({ fill: "pixelate" }), ...nodes], edges)?.source).toBe("bg")
    expect(keptLengthWire(x({ fill: "blur" }), [x({ fill: "blur" }), ...nodes], edges.slice(0, 1))).toBeUndefined()
  })
})

describe("maskCompositeEffectiveAudioSource", () => {
  it("leaves the video fill's choice alone", () => {
    for (const a of ["foreground", "background", "mix", "none"] as const) expect(maskCompositeEffectiveAudioSource({ fill: "video", audioSource: a })).toBe(a)
  })
  it("with no foreground it is ALWAYS the background's sound — a stored none (hidden on the canvas) never mutes the result", () => {
    for (const fill of ["pixelate", "blur"] as const) {
      for (const a of ["foreground", "background", "mix", "none"] as const) expect(maskCompositeEffectiveAudioSource({ fill, audioSource: a })).toBe("background")
    }
  })
})
