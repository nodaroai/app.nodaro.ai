import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import {
  FREE_VIDEO_LIMITS_DEFAULTS,
  freeVideoRefusal,
  freeVideoRequestOf,
  lowestResolution,
  resolutionHeight,
} from "../free-video-limits.js"
import { parseFreeVideoMaxSeconds } from "../../lib/free-video-config.js"

const ON = FREE_VIDEO_LIMITS_DEFAULTS
const videos = Object.values(MODEL_CATALOG as Record<string, ModelCatalogEntry>).filter((e) => e.kind === "video")

describe("free-credit video limits — blocked models", () => {
  it("every Kling model and Seedance 2.5 (and its HD finalizer) is refused, whatever the settings", () => {
    const blocked = videos.filter((e) => e.series === "Kling" || e.id === "seedance-2-5" || e.id.startsWith("seedance-2-5-"))
    // The catalog's own Kling series: generation, motion transfer and lip-sync.
    expect(blocked.map((e) => e.id)).toEqual(expect.arrayContaining(["kling", "kling-3.0", "kling-3-omni", "kling-3.0-motion", "kling-avatar", "seedance-2-5", "seedance-2-5-hd"]))
    for (const e of blocked) {
      expect(freeVideoRefusal({ provider: e.id, duration: 3, resolution: lowestResolution(e) }, ON), e.id).not.toBeNull()
    }
  })

  it("a new Kling SKU is covered by its series, with no list to edit", () => {
    const kling = videos.filter((e) => e.series === "Kling")
    expect(kling.length).toBeGreaterThan(5)
  })

  it("the trigger case: two 7-second 1080p Kling 3.0 clips", () => {
    expect(freeVideoRefusal({ provider: "kling-3.0", duration: 7, resolution: "1080P" }, ON)?.reason).toBe("free_video")
  })
})

describe("free-credit video limits — length and resolution", () => {
  it("the default video node (Seedance 2 Fast, 4 s, no resolution) runs", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4 }, ON)).toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4, resolution: "480p" }, ON)).toBeNull()
  })

  it("longer than 4 s, Auto, or above the lowest resolution is refused", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 5, resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: "8", resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: VIDEO_DURATION_AUTO, resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4, resolution: "720p" }, ON)).not.toBeNull()
  })

  it("an omitted resolution is the billed default: wan-3 bills 720p, so it must be asked for at 480p", () => {
    expect(freeVideoRefusal({ provider: "wan-3", duration: 4 }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "wan-3", duration: 4, resolution: "480p" }, ON)).toBeNull()
  })

  it("a model whose shortest clip is over the limit is not available at all", () => {
    expect(freeVideoRefusal({ provider: "minimax", duration: 5 }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "hailuo-2.3", duration: 6, resolution: "768P" }, ON)).not.toBeNull()
  })

  it("an omitted duration is the model's default", () => {
    // MiniMax H3's catalog default is longer than 4 s.
    expect(freeVideoRefusal({ provider: "minimax-h3", resolution: "768P" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "minimax-h3", duration: 4, resolution: "768P" }, ON)).toBeNull()
  })

  it("lowest is ordered by height, not by catalog order (MiniMax H3 lists 2K first)", () => {
    expect(lowestResolution(MODEL_CATALOG["minimax-h3"] as ModelCatalogEntry)).toBe("768P")
    expect(freeVideoRefusal({ provider: "minimax-h3", duration: 4, resolution: "2K" }, ON)).not.toBeNull()
  })

  it("Hailuo's high size is refused", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4, resolution: "480p", videoSize: "high" }, ON)).not.toBeNull()
  })

  it("every generation model the rule leaves open has a lowest resolution it can read", () => {
    for (const e of videos) {
      if (!e.modes.some((m) => m === "i2v" || m === "t2v") || !e.resolutions?.length) continue
      expect(lowestResolution(e), e.id).not.toBeNull()
    }
  })

  it("video upscaling is refused: a free user may not turn a 480p clip into 4K", () => {
    const upscalers = videos.filter((e) => e.modes.includes("video-upscale"))
    expect(upscalers.map((e) => e.id)).toEqual(expect.arrayContaining(["veo-1080p", "veo-4k", "topaz-video"]))
    for (const e of upscalers) expect(freeVideoRefusal({ provider: e.id }, ON), e.id).not.toBeNull()
  })

  it("other video lanes (extend, lip-sync, v2v) are not length-limited — only the blocked models", () => {
    const lanes = videos.filter((e) => !e.modes.some((m) => m === "i2v" || m === "t2v" || m === "video-upscale") && e.series !== "Kling" && !e.id.startsWith("seedance-2-5"))
    expect(lanes.length).toBeGreaterThan(0)
    for (const e of lanes) expect(freeVideoRefusal({ provider: e.id, duration: 30, resolution: "4k" }, ON), e.id).toBeNull()
  })
})

describe("free-credit video limits — knobs and inputs", () => {
  it("off means nothing is refused", () => {
    expect(freeVideoRefusal({ provider: "kling-3.0", duration: 10 }, { enabled: false, maxSeconds: 4 })).toBeNull()
  })

  it("the length limit follows the setting", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 6, resolution: "480p" }, { enabled: true, maxSeconds: 6 })).toBeNull()
    expect(parseFreeVideoMaxSeconds(6)).toBe(6)
    expect(parseFreeVideoMaxSeconds(0)).toBe(4)
    expect(parseFreeVideoMaxSeconds("6")).toBe(4)
    expect(parseFreeVideoMaxSeconds(4.5)).toBe(4)
  })

  it("a non-video provider is not this rule's business", () => {
    expect(freeVideoRefusal({ provider: "flux", duration: 30 }, ON)).toBeNull()
    expect(freeVideoRequestOf({ provider: "flux" })).toBeUndefined()
    expect(freeVideoRequestOf({ prompt: "x" })).toBeUndefined()
    expect(freeVideoRequestOf({ provider: "seedance-2-fast", duration: 4, resolution: "480p" })).toEqual({ provider: "seedance-2-fast", duration: 4, resolution: "480p", videoSize: null })
  })

  it("resolution heights", () => {
    expect(resolutionHeight("480p")).toBe(480)
    expect(resolutionHeight("768P")).toBe(768)
    expect(resolutionHeight("2K")).toBe(1440)
    expect(resolutionHeight("4k")).toBe(2160)
    expect(Number.isNaN(resolutionHeight("high"))).toBe(true)
  })
})
