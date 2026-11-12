import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { normalizeVideoUpscaleResolution, videoUpscaleModelOf, videoUpscaleResolutionsFor, VIDEO_UPSCALE_RESOLUTIONS } from "../video-upscale-params.js"
import { normalizeNodeModelParams } from "../normalize-node-params.js"
import { VIDEO_UPSCALE_PROVIDERS } from "../model-constants.js"
import { NODARO_VIDEO_UPSCALE_DEFAULT_TIER, NODARO_VIDEO_UPSCALE_TIERS } from "../nodaro-video-upscale.js"
import { TOPAZ_VIDEO_RESOLUTIONS } from "../topaz-video.js"

/**
 * The Video Upscale node's target resolution: held to what its provider takes
 * only for a provider whose catalog entry declares its resolutions — Nodaro
 * Video Upscale's 1080p / 2K / 4K. Topaz keeps its own list (720p / 1080p /
 * 4K, `TOPAZ_VIDEO_RESOLUTIONS`) and every other provider's node is left
 * exactly as it came: its run reads the field by its own rules.
 */
describe("Video Upscale target resolution per provider", () => {
  it("only Nodaro Video Upscale's catalog entry declares resolutions; the route's enum covers every provider's", () => {
    expect(videoUpscaleResolutionsFor("nodaro-video-upscale")).toEqual([...NODARO_VIDEO_UPSCALE_TIERS])
    for (const p of ["topaz", undefined, "veo-1080p", "veo-4k", "seedance-2-5-hd"]) {
      expect(videoUpscaleResolutionsFor(p), String(p)).toEqual([])
    }
    expect(MODEL_CATALOG["topaz-video"]).not.toHaveProperty("resolutions")
    expect(MODEL_CATALOG["topaz-video"]).not.toHaveProperty("defaultResolution")
    for (const p of VIDEO_UPSCALE_PROVIDERS) expect(MODEL_CATALOG[videoUpscaleModelOf(p)], p).toBeDefined()
    for (const r of [...TOPAZ_VIDEO_RESOLUTIONS, ...NODARO_VIDEO_UPSCALE_TIERS]) expect(VIDEO_UPSCALE_RESOLUTIONS).toContain(r)
  })

  it("coerces a value Nodaro Video Upscale does not take to its default, and canonicalises its spelling", () => {
    expect(MODEL_CATALOG["nodaro-video-upscale"]!.defaultResolution).toBe(NODARO_VIDEO_UPSCALE_DEFAULT_TIER)
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "720p").targetResolution).toBe("1080p")
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "720p").adjustment?.reason).toMatch(/Nodaro Video Upscale/)
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "2K")).toEqual({ targetResolution: "2k" })
  })

  it("leaves every other provider's value, and an unset value, as it came", () => {
    expect(normalizeVideoUpscaleResolution("topaz", "2k")).toEqual({ targetResolution: "2k" })
    expect(normalizeVideoUpscaleResolution("topaz", "4K")).toEqual({ targetResolution: "4K" })
    expect(normalizeVideoUpscaleResolution(undefined, "2k")).toEqual({ targetResolution: "2k" })
    expect(normalizeVideoUpscaleResolution("veo-4k", "1080p")).toEqual({ targetResolution: "1080p" })
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", undefined)).toEqual({ targetResolution: undefined })
    expect(normalizeVideoUpscaleResolution("nodaro-video-upscale", "")).toEqual({ targetResolution: undefined })
  })

  it("a node written straight into workflow JSON: only Nodaro Video Upscale's is healed; Topaz's, VEO's and an unnamed provider's come back as the same node", () => {
    const nodes = [
      // Topaz's spellings and another provider's target: left for its run, which drops what it does not take.
      { id: "a", type: "video-upscale", data: { provider: "topaz", targetResolution: "4K" } },
      // The old factor path stays: the run reads the factor when the target is not Topaz's.
      { id: "b", type: "video-upscale", data: { provider: "topaz", targetResolution: "2k", upscaleFactor: "2" } },
      // No provider named: Topaz, left alone.
      { id: "c", type: "video-upscale", data: { targetResolution: "720P" } },
      { id: "d", type: "video-upscale", data: { provider: "veo-4k", targetResolution: "2k" } },
      { id: "e", type: "video-upscale", data: { provider: "nodaro-video-upscale", targetResolution: "720p", label: "E" } },
      { id: "f", type: "video-upscale", data: { provider: "topaz", targetResolution: "8k", upscaleFactor: "4" } },
      { id: "g", type: "video-upscale", data: { provider: "topaz", targetResolution: "2k", targetFps: 30 } },
    ]
    const { nodes: out, adjustments } = normalizeNodeModelParams(nodes)
    for (const i of [0, 1, 2, 3, 5, 6]) expect(out[i], nodes[i]!.id).toBe(nodes[i])
    expect(out[4]!.data).toEqual({ provider: "nodaro-video-upscale", targetResolution: "1080p", label: "E" })
    expect(adjustments.map((a) => [a.nodeId, a.from, a.to])).toEqual([["e", "720p", "1080p"]])
  })
})
