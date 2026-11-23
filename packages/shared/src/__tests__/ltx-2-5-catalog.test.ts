import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  normalizeVideoRequestParams,
  videoDurationsAt,
  videoFrameRateFor,
} from "../model-catalog.js"
import {
  AUDIO_ADDON_PROVIDERS,
  GVP_SUPPORTED_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  LTX_2_5_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_MODE_ALIASES,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  applyVideoNegativePrompt,
  getMaxVideoPromptChars,
  getVideoAudioCapability,
  isLtx25Provider,
  normalizeLtx25Resolution,
  videoDurationCappedAt,
  videoModelCanSpeakDialogue,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier, pricedVideoSelection, videoGenerationCreditId } from "../credit-identifiers.js"
import { freeVideoDurationLock, freeVideoModelLock, FREE_VIDEO_LIMITS_DEFAULTS } from "../free-video-limits.js"
import { uiDurationFill, uiResolutionFill } from "../video-ui-defaults.js"
import { computeFrameFitPlan, resolveFrameFitAspect } from "../video-frame-fit.js"

/**
 * LTX 2.5 Fast / Pro (KIE) — a different model from LTX 2.3 (decided
 * 2026-11-22): one id per tier over a text-to-video and an image-to-video
 * endpoint, sound always on, a frame-rate setting, and on Fast a long-clip
 * limit (10 s at most at 1440p or 48 / 50 fps) held by the catalog.
 */
describe("LTX 2.5 — catalog entries", () => {
  it("two ids, both modes, made by Lightricks, in the LTX series", () => {
    expect([...LTX_2_5_PROVIDERS]).toEqual(["ltx-2.5-fast", "ltx-2.5-pro"])
    for (const id of LTX_2_5_PROVIDERS) {
      const m = MODEL_CATALOG[id]!
      expect(m.kind).toBe("video")
      expect([...m.modes]).toEqual(["i2v", "t2v"])
      expect(m.maker).toBe("lightricks")
      expect(m.series).toBe("LTX")
      expect([...(m.aspectRatios ?? [])]).toEqual(["16:9", "9:16", "1:1", "3:2", "2:3"])
      expect([...(m.frameRates ?? [])]).toEqual([24, 25, 48, 50])
      expect(m.defaultResolution).toBe("1080p")
      expect(m.unlistedResolutionRendersAs).toBe("1080p")
      expect(m.defaultDuration).toBe(10)
      expect(m.noNegativePrompt).toBe(true)
      expect(m.noSeed).toBeUndefined()
      expect([...(m.features ?? [])]).toEqual(["audio"])
      expect(getMaxVideoPromptChars(id)).toBe(5000)
    }
    expect(MODEL_CATALOG["ltx-2.5-fast"]!.label).toBe("LTX 2.5 Fast")
    expect(MODEL_CATALOG["ltx-2.5-pro"]!.label).toBe("LTX 2.5 Pro")
    expect([...(MODEL_CATALOG["ltx-2.5-fast"]!.resolutions ?? [])]).toEqual(["720p", "1080p", "1440p"])
    expect([...(MODEL_CATALOG["ltx-2.5-pro"]!.resolutions ?? [])]).toEqual(["720p", "1080p"])
    expect([...(MODEL_CATALOG["ltx-2.5-fast"]!.durations ?? [])]).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
    expect([...(MODEL_CATALOG["ltx-2.5-pro"]!.durations ?? [])]).toEqual([6, 8, 10])
    expect(MODEL_CATALOG["ltx-2.5-fast"]!.longClipLimit).toEqual({ maxSeconds: 10, resolutions: ["1440p"], frameRates: [48, 50] })
    expect(MODEL_CATALOG["ltx-2.5-pro"]!.longClipLimit).toBeUndefined()
  })

  it("is dispatchable on both lanes with no mode alias, and needs no image", () => {
    for (const id of LTX_2_5_PROVIDERS) {
      expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(VIDEO_MODE_ALIASES.some((g) => g.base === id || g.i2v === id || g.t2v === id)).toBe(false)
      expect(VIDEO_PROVIDERS_REQUIRING_IMAGE.has(id)).toBe(false)
    }
  })

  it("is listed directly above the LTX 2.3 pair in both provider lists", () => {
    for (const list of [IMAGE_TO_VIDEO_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS] as ReadonlyArray<readonly string[]>) {
      const at = list.indexOf("ltx-2.3-pro")
      expect(list.slice(at - 2, at + 2)).toEqual(["ltx-2.5-fast", "ltx-2.5-pro", "ltx-2.3-pro", "ltx-2.3-fast"])
    }
  })

  it("sound is always generated: no switch, nothing priced, not a dialogue model", () => {
    for (const id of LTX_2_5_PROVIDERS) {
      expect(getVideoAudioCapability(id)).toEqual({ mode: "ambient", alwaysOn: true, defaultOn: true })
      expect(AUDIO_ADDON_PROVIDERS.has(id)).toBe(false)
      expect(videoModelCanSpeakDialogue(id)).toBe(false)
    }
  })

  it("is not offered by Generate Video Pro (no reference images, no gvpWithoutReferences)", () => {
    for (const id of LTX_2_5_PROVIDERS) {
      expect(MODEL_CATALOG[id]!.features?.includes("reference-image")).toBe(false)
      expect(MODEL_CATALOG[id]!.gvpWithoutReferences).toBeUndefined()
      expect(GVP_SUPPORTED_PROVIDERS as readonly string[]).not.toContain(id)
    }
  })
})

describe("LTX 2.5 — the frame rate and the long-clip limit", () => {
  it("reads a frame rate the model lists, else its default 24; nothing for a model without the setting", () => {
    expect(videoFrameRateFor("ltx-2.5-fast", 50)).toBe(50)
    expect(videoFrameRateFor("ltx-2.5-fast", "25")).toBe(25)
    expect(videoFrameRateFor("ltx-2.5-pro", 30)).toBe(24)
    expect(videoFrameRateFor("ltx-2.5-pro", undefined)).toBe(24)
    for (const other of ["ltx-2.3-pro", "ltx-2.3-fast", "pixverse-v6-max", "seedance-2-fast"]) {
      expect(videoFrameRateFor(other, 50), other).toBeUndefined()
    }
  })

  it("Fast offers 6-20 s at 720p / 1080p and 24 / 25 fps, 6-10 s at 1440p or 48 / 50 fps", () => {
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "720p", fps: 24 })).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "1080p", fps: 25 })).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "1440p", fps: 24 })).toEqual([6, 8, 10])
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "1440P" })).toEqual([6, 8, 10])
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "720p", fps: 48 })).toEqual([6, 8, 10])
    expect(videoDurationsAt("ltx-2.5-fast", { resolution: "1080p", fps: 50 })).toEqual([6, 8, 10])
    expect(videoDurationsAt("ltx-2.5-pro", { resolution: "720p", fps: 50 })).toEqual([6, 8, 10])
  })

  it("a length past the limit moves down to the nearest one rendered there", () => {
    expect(videoDurationCappedAt("ltx-2.5-fast", 16, { resolution: "1440p" })).toBe(10)
    expect(videoDurationCappedAt("ltx-2.5-fast", 20, { resolution: "720p", fps: 50 })).toBe(10)
    expect(videoDurationCappedAt("ltx-2.5-fast", 8, { resolution: "1440p", fps: 50 })).toBe(8)
    expect(videoDurationCappedAt("ltx-2.5-fast", 20, { resolution: "720p", fps: 25 })).toBe(20)
    // Every model without the limit gets its length back exactly as given — never snapped onto its list.
    expect(videoDurationCappedAt("ltx-2.3-fast", 20, { resolution: "4k", fps: 50 })).toBe(20)
    expect(videoDurationCappedAt("seedance-2-5", 30, { resolution: "1080p", fps: 50 })).toBe(30)
    expect(videoDurationCappedAt("ltx-2.3-pro", 7, { resolution: "1080p" })).toBe(7)
    expect(videoDurationCappedAt("kling", 7, {})).toBe(7)
    expect(videoDurationCappedAt("pixverse-v6-max", 99, {})).toBe(99)
  })

  it("1440p is its own tier on Fast — never read as 2K; anything else runs at 1080p", () => {
    expect(normalizeLtx25Resolution("ltx-2.5-fast", "1440p")).toBe("1440p")
    expect(normalizeLtx25Resolution("ltx-2.5-fast", "1440P")).toBe("1440p")
    expect(normalizeLtx25Resolution("ltx-2.5-fast", "2k")).toBe("1080p")
    expect(normalizeLtx25Resolution("ltx-2.5-pro", "1440p")).toBe("1080p")
    expect(normalizeLtx25Resolution("ltx-2.5-pro", undefined)).toBe("1080p")
    expect(normalizeVideoRequestParams("ltx-2.5-fast", { resolution: "1440p" }).resolution).toBe("1440p")
    expect(normalizeVideoRequestParams("ltx-2.5-fast", { resolution: "2k" }).resolution).toBe("1080p")
    expect(normalizeVideoRequestParams("ltx-2.5-pro", { resolution: "1440p" }).resolution).toBe("1080p")
  })
})

describe("LTX 2.5 — credit identifiers", () => {
  it("one row per length and resolution, the identifier holding the 1440p limit", () => {
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", 6, undefined, "image-to-video", undefined, "720p")).toBe("ltx-2.5-fast:6s:720p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", 20, undefined, "text-to-video", undefined, "1080p")).toBe("ltx-2.5-fast:20s:1080p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", 20, undefined, "text-to-video", undefined, "1440p")).toBe("ltx-2.5-fast:10s:1440p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-fast", undefined, undefined, "text-to-video")).toBe("ltx-2.5-fast:10s:1080p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-pro", 20, undefined, "text-to-video", undefined, "720p")).toBe("ltx-2.5-pro:10s:720p")
    expect(buildVideoCreditModelIdentifier("ltx-2.5-pro", 7, undefined, "image-to-video", undefined, "4k")).toBe("ltx-2.5-pro:6s:1080p")
  })

  it("the frame rate's half of the limit is read where the frame rate is known", () => {
    expect(pricedVideoSelection({ provider: "ltx-2.5-fast", resolution: "720p", duration: 20, fps: 50 }).duration).toBe(10)
    expect(pricedVideoSelection({ provider: "ltx-2.5-fast", resolution: "720p", duration: 20, fps: 24 }).duration).toBe(20)
    expect(pricedVideoSelection({ provider: "ltx-2.5-fast", duration: 20 })).toMatchObject({ resolution: "1080p", duration: 20 })
    expect(videoGenerationCreditId({ provider: "ltx-2.5-fast", duration: 18, resolution: "1080p", fps: 48 })).toBe("ltx-2.5-fast:10s:1080p")
    expect(videoGenerationCreditId({ provider: "ltx-2.5-fast", duration: 18, resolution: "1080p" })).toBe("ltx-2.5-fast:18s:1080p")
  })

  it("the editor fills the declared 1080p / 10 s defaults", () => {
    for (const id of LTX_2_5_PROVIDERS) {
      expect(uiResolutionFill(id)).toBe("1080p")
      expect(uiDurationFill(id)).toBe(10)
    }
  })
})

describe("LTX 2.5 — negative prompt and free credits", () => {
  it("a negative prompt is dropped, never folded into the prompt", () => {
    expect(applyVideoNegativePrompt("a lighthouse", "blur", "ltx-2.5-fast")).toEqual({ prompt: "a lighthouse", nativeNegativePrompt: undefined })
    // Every other non-native model still folds it.
    expect(applyVideoNegativePrompt("a lighthouse", "blur", "pixverse-v6-max").prompt).toContain("Avoid: blur")
    expect(applyVideoNegativePrompt("a lighthouse", "blur", "ltx-2.3-pro").prompt).toContain("Avoid: blur")
  })

  it("is locked on free credits: its shortest clip (6 s) is past the 4 s limit", () => {
    for (const id of LTX_2_5_PROVIDERS) {
      expect(freeVideoModelLock(id, FREE_VIDEO_LIMITS_DEFAULTS)).toEqual({ kind: "shortest", label: MODEL_CATALOG[id]!.label, max: 4, shortest: 6 })
      expect(freeVideoDurationLock(id, 6, FREE_VIDEO_LIMITS_DEFAULTS)).toEqual({ kind: "duration", label: MODEL_CATALOG[id]!.label, max: 4 })
    }
  })
})

describe("LTX 2.3 is untouched by LTX 2.5", () => {
  it("no new LTX field on the 2.3 entries, and its identifiers keep their band-first shape", () => {
    for (const id of ["ltx-2.3-pro", "ltx-2.3-fast"]) {
      const m = MODEL_CATALOG[id]!
      expect(m.frameRates).toBeUndefined()
      expect(m.longClipLimit).toBeUndefined()
      expect(m.noNegativePrompt).toBeUndefined()
      expect(isLtx25Provider(id)).toBe(false)
    }
    expect(buildVideoCreditModelIdentifier("ltx-2.3-fast", 16, undefined, "text-to-video", undefined, "1080p")).toBe("ltx-2.3-fast:1080p:16s")
    expect(buildVideoCreditModelIdentifier("ltx-2.3-pro", 7, undefined, "image-to-video", undefined, "2k")).toBe("ltx-2.3-pro:2k:6s")
    expect(pricedVideoSelection({ provider: "ltx-2.3-fast", resolution: "1080p", duration: 20, fps: 50 }).duration).toBe(20)
  })

  it("a filter on the 2.3 ids' prefix does not sweep in the 2.5 ids", () => {
    const ltx23 = Object.keys(MODEL_CATALOG).filter((id) => id.startsWith("ltx-2.3"))
    expect(ltx23.sort()).toEqual(["ltx-2.3-fast", "ltx-2.3-pro"])
  })
})

describe("LTX 2.5 — the start frame keeps its shape", () => {
  it("no ratio is a frame-fit target: neither a stored one nor the nearest listed", () => {
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      expect(MODEL_CATALOG[id]!.aspectRatiosTextOnly).toBe(true)
      expect(resolveFrameFitAspect({ provider: id, requestedAspect: "9:16", sourceWidth: 1920, sourceHeight: 1080 })).toBeUndefined()
      expect(resolveFrameFitAspect({ provider: id, requestedAspect: undefined, sourceWidth: 1600, sourceHeight: 1200 })).toBeUndefined()
      expect(computeFrameFitPlan({ fit: "resolution", provider: id, resolution: "1080p", aspect: "9:16", sourceWidth: 1920, sourceHeight: 1080 })).toBeNull()
    }
    // Every other model keeps the rule it had.
    expect(resolveFrameFitAspect({ provider: "pixverse-v6-max", requestedAspect: "9:16", sourceWidth: 1920, sourceHeight: 1080 })).toBe("9:16")
    expect(MODEL_CATALOG["ltx-2.3-pro"]!.aspectRatiosTextOnly).toBeUndefined()
  })
})

describe("the long-clip cap moves no other model's price", () => {
  it("every other video model's identifier at every length and resolution it lists is what it was without the cap", () => {
    for (const m of Object.values(MODEL_CATALOG)) {
      if (m.kind !== "video" || m.longClipLimit) continue
      for (const d of [undefined, ...(m.durations ?? []), 7, 13]) {
        for (const r of [undefined, ...(m.resolutions ?? [])]) {
          for (const mode of ["image-to-video", "text-to-video"] as const) {
            const id = buildVideoCreditModelIdentifier(m.id, d, undefined, mode, undefined, r)
            // The cap is the identity for such a model, so the duration the builder priced is untouched.
            expect(videoDurationCappedAt(m.id, d ?? 0, { resolution: r, fps: 50 }), `${m.id} ${d} ${r}`).toBe(d ?? 0)
            expect(typeof id).toBe("string")
          }
        }
      }
    }
  })
})
