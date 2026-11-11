import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import {
  FREE_OPEN_VIDEO_MODELS,
  FREE_VIDEO_LIMITS_DEFAULTS,
  freeVideoModelRefusal,
  freeVideoRefusal,
  freeVideoRequestForJob,
  freeVideoRequestOf,
  isVideoModelId,
  lowestResolution,
  resolutionHeight,
} from "../free-video-limits.js"
import { parseFreeVideoMaxSeconds } from "../../lib/free-video-config.js"
import { IMAGE_TO_VIDEO_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS, VIDEO_GEN_PROVIDERS } from "@nodaro/shared/models"
import { freeVideoLock } from "@nodaro/render-rules"

const ON = FREE_VIDEO_LIMITS_DEFAULTS
const videos = Object.values(MODEL_CATALOG as Record<string, ModelCatalogEntry>).filter((e) => e.kind === "video")

describe("free-credit video limits — blocked models", () => {
  it("every Kling model but Kling 4.0 Flash, and Seedance 2.5 (and its HD finalizer), is refused, whatever the settings", () => {
    const blocked = videos.filter((e) => (e.series === "Kling" && e.id !== "kling-4-flash") || e.id === "seedance-2-5" || e.id.startsWith("seedance-2-5-"))
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

  it("Kling 4.0 Flash is the one open Kling model (decided 2026-11-11), and only it", () => {
    expect(FREE_OPEN_VIDEO_MODELS).toEqual(["kling-4-flash"])
    expect(freeVideoModelRefusal("kling-4-flash", ON)).toBeNull()
    for (const id of ["kling-4", "kling-4-keyframes", "kling-3.0", "kling"]) {
      expect(freeVideoModelRefusal(id, ON), id).not.toBeNull()
    }
    // Exact ids: no catalog model rides the exception by prefix.
    expect(videos.filter((e) => e.id.startsWith("kling-4-flash")).map((e) => e.id)).toEqual(["kling-4-flash"])
  })

  it("Kling 4.0 Flash runs on free credits within the limits: 3-4 s at 720p, its only resolution", () => {
    expect(freeVideoRefusal({ provider: "kling-4-flash", duration: 3, resolution: "720p" }, ON)).toBeNull()
    expect(freeVideoRefusal({ provider: "kling-4-flash", duration: 4, resolution: "720p" }, ON)).toBeNull()
    // An omitted resolution is its billed default, 720p.
    expect(freeVideoRefusal({ provider: "kling-4-flash", duration: 4 }, ON)).toBeNull()
    // Past 4 s, or with no length named (its default is 5 s), it is refused like any open model.
    expect(freeVideoRefusal({ provider: "kling-4-flash", duration: 5, resolution: "720p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "kling-4-flash", resolution: "720p" }, ON)).not.toBeNull()
    // The workflow lane reads the same rule from the node payload.
    expect(freeVideoRefusal(freeVideoRequestOf({ provider: "kling-4-flash", duration: 4, resolution: "720p" })!, ON)).toBeNull()
  })

  it("the trigger case: two 7-second 1080p Kling 3.0 clips", () => {
    expect(freeVideoRefusal({ provider: "kling-3.0", duration: 7, resolution: "1080P" }, ON)?.reason).toBe("free_video")
  })
})

describe("free-credit video limits — length and resolution", () => {
  it("the default video node (Seedance 2 Fast, 4 s, the 480p the routes fill) runs", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4, resolution: "480p" }, ON)).toBeNull()
  })

  it("an OMITTED resolution on a model with several is unknown — the provider renders its own default (KIE: 720p)", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4 }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-mini", duration: 4 }, ON)).not.toBeNull()
  })

  it("longer than 4 s, Auto, or above the lowest resolution is refused", () => {
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 5, resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: "8", resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: VIDEO_DURATION_AUTO, resolution: "480p" }, ON)).not.toBeNull()
    expect(freeVideoRefusal({ provider: "seedance-2-fast", duration: 4, resolution: "720p" }, ON)).not.toBeNull()
  })

  it("an omitted resolution with a DECLARED default is that default: wan-3 bills 720p, so it must be asked for at 480p", () => {
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

  it("Grok Imagine's text-to-video id (\"grok\", the catalog's IMAGE model) is judged as its video twin", () => {
    expect(freeVideoRefusal({ provider: "grok", duration: 6 }, ON)).not.toBeNull()
    expect(freeVideoRequestOf({ provider: "grok", duration: 10 })?.provider).toBe("grok")
  })

  it("every video id a request may name resolves to a catalog video model (no unseen alias)", () => {
    const ids = [...VIDEO_GEN_PROVIDERS, ...TEXT_TO_VIDEO_PROVIDERS, ...IMAGE_TO_VIDEO_PROVIDERS]
    for (const id of new Set(ids)) expect(freeVideoRequestOf({ provider: id }), id).toBeDefined()
  })

  it("video extension is refused: 4 s at 480p must not become 15 s at 1080p", () => {
    const extenders = videos.filter((e) => e.modes.includes("extend"))
    expect(extenders.map((e) => e.id)).toEqual(expect.arrayContaining(["seedance-2-5-extend", "seedance-2-0-extend"]))
    for (const e of extenders) expect(freeVideoRefusal({ provider: e.id, duration: 4, resolution: "480p" }, ON), e.id).not.toBeNull()
  })

  it("video upscaling is refused: a free user may not turn a 480p clip into 4K", () => {
    const upscalers = videos.filter((e) => e.modes.includes("video-upscale"))
    expect(upscalers.map((e) => e.id)).toEqual(expect.arrayContaining(["veo-1080p", "veo-4k", "topaz-video"]))
    for (const e of upscalers) expect(freeVideoRefusal({ provider: e.id }, ON), e.id).not.toBeNull()
  })

  it("other video lanes (extend, lip-sync, v2v) are not length-limited — only the blocked models", () => {
    const lanes = videos.filter((e) => !e.modes.some((m) => m === "i2v" || m === "t2v" || m === "video-upscale" || m === "extend") && e.series !== "Kling" && !e.id.startsWith("seedance-2-5"))
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

describe("free-credit video limits — only video lanes are judged", () => {
  it("a music job whose provider is \"minimax\" is not a Hailuo video", () => {
    expect(freeVideoRequestForJob("generate-music", "generate-music", { provider: "minimax", duration: 60 })).toBeUndefined()
  })

  it("an image job on \"grok\" is not Grok Imagine video", () => {
    expect(isVideoModelId("grok")).toBe(false)
    expect(freeVideoRequestForJob("generate-image", "grok", { provider: "grok" })).toBeUndefined()
  })

  it("a video job is judged, including Grok's text-to-video id", () => {
    expect(freeVideoRequestForJob("text-to-video", "grok:6s", { provider: "grok", duration: 6 })?.provider).toBe("grok")
    expect(freeVideoRequestForJob("generate-video-pro", "generate-video-pro", { provider: "seedance-2", duration: 30 })?.duration).toBe(30)
  })

  // LTX 2.3 Pro extends under its GENERATION model's id (`ltx-2.3-pro`), so its
  // catalog entry cannot say the run is an extension. The job's lane says it:
  // an Extend Video job carries the extension mark and is refused with the
  // lock VEO and Runway get — never judged by the generation model's lengths
  // and resolutions, which let it through once the length setting reaches 6 s.
  // The workflow lane (node-executor) and the pipeline lane both read this.
  it("an Extend Video job is an extension whatever model its provider names (LTX 2.3 Pro)", () => {
    const ltx = freeVideoRequestForJob("extend-video", "ltx-2.3-pro-extend:per-second", { provider: "ltx-2.3-pro", duration: 6, resolution: "1080p" })
    expect(ltx?.extend).toBe(true)
    for (const limits of [ON, { enabled: true, maxSeconds: 10 }]) {
      expect(freeVideoRefusal(ltx!, limits)?.error, String(limits.maxSeconds)).toMatch(/^Extending video is not available on free credits/)
    }
    expect(freeVideoRefusal(ltx!, { enabled: false, maxSeconds: 4 })).toBeNull()
    for (const provider of ["veo-extend", "runway-extend", "seedance-2-5-extend", "seedance-2-0-extend"]) {
      const job = freeVideoRequestForJob("extend-video", provider, { provider })
      expect(freeVideoRefusal(job!, ON)?.error, provider).toMatch(/^Extending video is not available on free credits/)
    }
  })

  // Defence in depth: an Extend Video job whose provider no catalog entry
  // knows (a retired id that slipped past normalization, a provider added to
  // the lane before the catalog) is still an extension, refused by its id.
  it("an Extend Video job is refused even when its provider names no catalog model (label = the provider id)", () => {
    for (const provider of ["seedance-2-extend", "no-such-extend"]) {
      const job = freeVideoRequestForJob("extend-video", `${provider}:8s:720p`, { provider, duration: 8, resolution: "720p" })
      expect(job, provider).toMatchObject({ provider, duration: 8, resolution: "720p", extend: true })
      expect(freeVideoLock(job!, ON), provider).toEqual({ kind: "extend", label: provider })
      expect(freeVideoRefusal(job!, ON)?.error, provider).toMatch(/^Extending video is not available on free credits/)
      expect(freeVideoRefusal(job!, { enabled: false, maxSeconds: 4 }), provider).toBeNull()
    }
    // A payload that names no provider is judged by the id it reserves under.
    const unnamed = freeVideoRequestForJob("extend-video", "veo-extend:quality", {})
    expect(unnamed).toMatchObject({ provider: "veo-extend", extend: true })
    expect(freeVideoRefusal(unnamed!, ON)?.error).toMatch(/^Extending video is not available on free credits/)
    // Any other job naming no catalog model is still no video request.
    expect(freeVideoRequestForJob("generate-video", "no-such-model:8s", { provider: "no-such-model" })).toBeUndefined()
  })

  it("LTX 2.3 Pro generation is still judged as generation (the extension mark rides the Extend Video lane only)", () => {
    const gen = freeVideoRequestForJob("generate-video", "ltx-2.3-pro:1080p:6s", { provider: "ltx-2.3-pro", duration: 6, resolution: "1080p" })
    expect(gen?.extend).toBeUndefined()
    expect(freeVideoRefusal(gen!, { enabled: true, maxSeconds: 10 })).toBeNull()
  })
})
