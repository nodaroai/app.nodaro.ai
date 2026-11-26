import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, hasFeature, normalizeModelInput } from "../model-catalog.js"
import {
  videoHdrResolution,
  videoHdrResolutionProblem,
  videoRunsHdr,
  videoTakesHdr,
  VIDEO_HDR_RESOLUTION_CODE,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier, tailExtendResolution, videoHdrAddonCreditId } from "../credit-identifiers.js"
import { normalizeNodeModelParams } from "../normalize-node-params.js"

/**
 * Kling 4.0 HDR (decided 2026-11-22): both ids, 1080p and 4K only, priced as
 * its own add-on line on the output seconds; Flash and every other model have
 * no such setting.
 */
describe("the HDR setting in the catalog", () => {
  it("is declared on kling-4 and kling-4-keyframes only, with the feature `hdr` beside it", () => {
    const withHdr = Object.values(MODEL_CATALOG).filter((m) => m.hdr !== undefined).map((m) => m.id).sort()
    expect(withHdr).toEqual(["kling-4", "kling-4-keyframes"])
    for (const m of Object.values(MODEL_CATALOG)) expect(hasFeature(m.id, "hdr"), m.id).toBe(m.hdr !== undefined)
    for (const id of withHdr) {
      expect(MODEL_CATALOG[id]!.hdr).toEqual({ resolutions: ["1080p", "4k"], addonCreditPrefix: "kling-4-hdr" })
      // Every HDR size is a size the model lists.
      for (const r of MODEL_CATALOG[id]!.hdr!.resolutions) expect(MODEL_CATALOG[id]!.resolutions).toContain(r)
    }
    expect(videoTakesHdr("kling-4-flash")).toBe(false)
    expect(videoTakesHdr("seedance-2-5")).toBe(false)
  })

  it("Kling 4.0 Flash keeps its ratios and its one size; Kling 4.0 gains 4:3", () => {
    expect(MODEL_CATALOG["kling-4-flash"]!.resolutions).toEqual(["720p"])
    expect(MODEL_CATALOG["kling-4-flash"]!.aspectRatios).not.toContain("4:3")
    expect(MODEL_CATALOG["kling-4"]!.aspectRatios).toContain("4:3")
    expect(MODEL_CATALOG["kling-4-keyframes"]!.aspectRatios).toContain("4:3")
  })
})

describe("videoRunsHdr / videoHdrResolution", () => {
  it("is HDR only on a model with the setting asked `hdr` (any case)", () => {
    expect(videoRunsHdr("kling-4", "hdr")).toBe(true)
    expect(videoRunsHdr("kling-4-keyframes", " HDR ")).toBe(true)
    for (const v of [undefined, "sdr", "", "hlg", 1]) expect(videoRunsHdr("kling-4", v)).toBe(false)
    expect(videoRunsHdr("kling-4-flash", "hdr")).toBe(false)
    expect(videoRunsHdr("veo3", "hdr")).toBe(false)
  })

  it("the HDR size is the rendered one, and none at a size that does not render it", () => {
    expect(videoHdrResolution("kling-4", "1080p", "hdr")).toBe("1080p")
    expect(videoHdrResolution("kling-4", "4K", "hdr")).toBe("4k")
    expect(videoHdrResolution("kling-4", "720p", "hdr")).toBeUndefined()
    expect(videoHdrResolution("kling-4", undefined, "hdr")).toBeUndefined()
    expect(videoHdrResolution("kling-4", "1080p", "sdr")).toBeUndefined()
  })
})

describe("the 720p + HDR refusal (videoHdrResolutionProblem)", () => {
  it("refuses HDR at 720p, an unlisted size and no size (it renders 720p), naming the sizes HDR takes", () => {
    for (const resolution of ["720p", "720P", undefined, "480p", "garbage"]) {
      const p = videoHdrResolutionProblem("kling-4", { resolution, dynamicRange: "hdr", nothingCharged: true })
      expect(p?.code, String(resolution)).toBe(VIDEO_HDR_RESOLUTION_CODE)
      expect(p?.resolution).toBe("720p")
      expect(p?.hdrResolutions).toEqual(["1080p", "4k"])
      expect(p?.message).toBe("Kling 4.0 renders HDR at 1080p or 4k only, not 720p. Choose 1080p or 4k, or turn HDR off. Nothing was charged.")
    }
  })

  it("lets HDR at 1080p and 4K, SDR at any size, and every model without the setting through", () => {
    expect(videoHdrResolutionProblem("kling-4", { resolution: "1080p", dynamicRange: "hdr" })).toBeUndefined()
    expect(videoHdrResolutionProblem("kling-4-keyframes", { resolution: "4k", dynamicRange: "hdr" })).toBeUndefined()
    expect(videoHdrResolutionProblem("kling-4", { resolution: "720p", dynamicRange: "sdr" })).toBeUndefined()
    expect(videoHdrResolutionProblem("kling-4", { resolution: "720p", dynamicRange: undefined })).toBeUndefined()
    // Flash has no HDR: the value is dropped, never refused.
    expect(videoHdrResolutionProblem("kling-4-flash", { resolution: "720p", dynamicRange: "hdr" })).toBeUndefined()
  })
})

describe("the credit ids", () => {
  it("4k renders and bills 4K on both ids, with a 4K -ref rate on kling-4 only", () => {
    expect(buildVideoCreditModelIdentifier("kling-4", 5, undefined, "image-to-video", undefined, "4k", false)).toBe("kling-4:5s:4k")
    expect(buildVideoCreditModelIdentifier("kling-4", 5, undefined, "text-to-video", undefined, "4K", false)).toBe("kling-4:5s:4k")
    expect(buildVideoCreditModelIdentifier("kling-4", 8, undefined, "image-to-video", undefined, "4k", true)).toBe("kling-4:8s:4k-ref")
    expect(buildVideoCreditModelIdentifier("kling-4-keyframes", 10, undefined, "image-to-video", undefined, "4k", true)).toBe("kling-4-keyframes:10s:4k")
    // Flash is unchanged: 720p whatever it is asked.
    expect(buildVideoCreditModelIdentifier("kling-4-flash", 5, undefined, "image-to-video", undefined, "4k", false)).toBe("kling-4-flash:5s:720p")
  })

  it("Kling 4.0 Extend is out of scope: a 4k request still renders and is priced at 720p", () => {
    expect(MODEL_CATALOG["kling-4-extend"]!.resolutions).toEqual(["720p", "1080p"])
    expect(MODEL_CATALOG["kling-4-extend"]!.hdr).toBeUndefined()
    expect(tailExtendResolution("kling-4-extend", "4k")).toBe("720p")
    expect(buildVideoCreditModelIdentifier("kling-4-extend", 5, undefined, "image-to-video", undefined, "4k", false)).toBe("kling-4-extend:5s:720p")
  })

  it("the HDR add-on is its own id on the output seconds, shared by both ids, never on the -ref ladder", () => {
    expect(videoHdrAddonCreditId("kling-4", 5, "1080p", "hdr")).toBe("kling-4-hdr:5s:1080p")
    expect(videoHdrAddonCreditId("kling-4-keyframes", 30, "4k", "hdr")).toBe("kling-4-hdr:30s:4k")
    // The length the run renders: unset is the model's default, an off-list one the nearest.
    expect(videoHdrAddonCreditId("kling-4", undefined, "4k", "hdr")).toBe("kling-4-hdr:5s:4k")
    expect(videoHdrAddonCreditId("kling-4", 31, "1080p", "hdr")).toBe("kling-4-hdr:30s:1080p")
    // None for SDR, for a refused size, and on any other model.
    expect(videoHdrAddonCreditId("kling-4", 5, "1080p", "sdr")).toBeUndefined()
    expect(videoHdrAddonCreditId("kling-4", 5, "720p", "hdr")).toBeUndefined()
    expect(videoHdrAddonCreditId("kling-4-flash", 5, "720p", "hdr")).toBeUndefined()
  })
})

describe("normalizeModelInput's HDR lever", () => {
  it("moves HDR at 720p (or no size) to 1080p and says so", () => {
    const at720 = normalizeModelInput("kling-4", { resolution: "720p", dynamicRange: "hdr" })
    expect(at720.resolution).toBe("1080p")
    expect(at720.dynamicRange).toBe("hdr")
    expect(at720.adjustments).toEqual([expect.objectContaining({ field: "resolution", from: "720p", to: "1080p" })])
    expect(normalizeModelInput("kling-4-keyframes", { dynamicRange: "hdr" }).resolution).toBe("1080p")
  })

  it("keeps HDR at 1080p and 4K, and SDR at any size", () => {
    expect(normalizeModelInput("kling-4", { resolution: "4k", dynamicRange: "hdr" })).toMatchObject({ resolution: "4k", dynamicRange: "hdr", adjustments: [] })
    expect(normalizeModelInput("kling-4", { resolution: "720p", dynamicRange: "sdr" }).resolution).toBe("720p")
  })

  it("drops the setting on a model without it, and reads an unknown value as SDR", () => {
    const flash = normalizeModelInput("kling-4-flash", { resolution: "720p", dynamicRange: "hdr" })
    expect(flash.dynamicRange).toBeUndefined()
    expect(flash.resolution).toBe("720p")
    expect(flash.adjustments).toEqual([expect.objectContaining({ field: "dynamicRange", from: "hdr", to: undefined })])
    expect(normalizeModelInput("kling-4", { resolution: "1080p", dynamicRange: "hlg" }).dynamicRange).toBe("sdr")
  })

  it("a Generate Video node written as JSON is held the same way (normalizeNodeModelParams)", () => {
    const input = [
      { id: "a", type: "generate-video", data: { provider: "kling-4", resolution: "720p", dynamicRange: "hdr" } },
      { id: "b", type: "generate-video", data: { provider: "kling-4-flash", dynamicRange: "hdr" } },
      { id: "c", type: "generate-video", data: { provider: "kling-4", resolution: "4k", dynamicRange: "hdr" } },
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect((nodes[0]!.data as Record<string, unknown>).resolution).toBe("1080p")
    expect((nodes[0]!.data as Record<string, unknown>).dynamicRange).toBe("hdr")
    expect("dynamicRange" in (nodes[1]!.data as Record<string, unknown>)).toBe(false)
    expect(adjustments.map((a) => a.nodeId)).toEqual(["a", "b"])
    // A node that fits is returned as it came.
    expect(nodes[2]).toBe(input[2])
  })
})
