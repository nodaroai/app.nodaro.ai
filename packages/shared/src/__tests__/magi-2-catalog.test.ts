import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, defaultResolutionFor } from "../model-catalog.js"
import {
  GVP_EXTEND_PROVIDERS,
  GVP_SUPPORTED_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  PRICING_DEFAULT_RESOLUTION,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  VIDEO_REF_AUDIO_RULES,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  getMaxVideoPromptChars,
  getVideoAudioCapability,
  isMagi2Provider,
  isSeedance2Provider,
  billsReferenceVideoSeconds,
  refVideoFormatProblem,
  videoProviderFoldsLoneEndFrame,
  videoProviderRefsReplaceStartFrame,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"
import { uiDurationFill, uiResolutionFill } from "../video-ui-defaults.js"

const entry = MODEL_CATALOG["magi-2"]!

describe("MAGI-2 catalog entry (decided 2026-11-26)", () => {
  it("is one video id for text and frames, made by Sand AI", () => {
    expect(entry.kind).toBe("video")
    expect(entry.label).toBe("MAGI-2")
    expect(entry.modes).toEqual(["i2v", "t2v"])
    expect(entry.maker).toBe("sand-ai")
    expect(MODEL_MAKERS["sand-ai"].name).toBe("Sand AI")
    expect((IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes("magi-2")).toBe(true)
    expect((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes("magi-2")).toBe(true)
    expect(VIDEO_PROVIDERS_REQUIRING_IMAGE.has("magi-2")).toBe(false)
  })

  it("renders 1080p only, 4-30 s whole seconds, 5 s by default", () => {
    expect(entry.resolutions).toEqual(["1080p"])
    expect(defaultResolutionFor("magi-2")).toBe("1080p")
    expect(PRICING_DEFAULT_RESOLUTION["magi-2"]).toBe("1080p")
    expect(entry.durations).toEqual(Array.from({ length: 27 }, (_, i) => i + 4))
    expect(entry.defaultDuration).toBe(5)
    expect(uiResolutionFill("magi-2")).toBe("1080p")
    expect(uiDurationFill("magi-2")).toBe(5)
    expect(entry.noNegativePrompt).toBe(true)
    expect(entry.noSeed).toBeUndefined()
    expect(getMaxVideoPromptChars("magi-2")).toBe(15000)
  })

  it("prices 44 credits a second rounded up to the next 10, at any resolution or sound setting", () => {
    for (let s = 4; s <= 30; s++) {
      expect(buildVideoCreditModelIdentifier("magi-2", s, undefined, undefined, undefined, "1080p")).toBe(`magi-2:${s}s:1080p`)
    }
    // A resolution the model does not render, or none, is priced as the one it does.
    expect(buildVideoCreditModelIdentifier("magi-2", 8, undefined, undefined, undefined, "720p")).toBe("magi-2:8s:1080p")
    expect(buildVideoCreditModelIdentifier("magi-2", undefined)).toBe("magi-2:5s:1080p")
    for (const row of entry.pricing) {
      const m = /^magi-2:(\d+)s:1080p$/.exec(row.identifier)
      const seconds = m ? Number(m[1]) : 5
      expect(row.credits, row.identifier).toBe(Math.ceil((44 * seconds) / 10) * 10)
    }
  })

  it("is not a Seedance model and bills no reference seconds", () => {
    expect(isMagi2Provider("magi-2")).toBe(true)
    expect(isSeedance2Provider("magi-2")).toBe(false)
    expect(billsReferenceVideoSeconds("magi-2")).toBe(false)
  })

  it("folds a lone end frame and runs from references alone", () => {
    expect(videoProviderFoldsLoneEndFrame("magi-2")).toBe(true)
    expect(videoProviderRefsReplaceStartFrame("magi-2")).toBe(true)
  })

  it("declares its reference clip limits and formats", () => {
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS["magi-2"]).toEqual({ minSec: 2, maxSec: 30, maxTotalSec: 30 })
    expect(VIDEO_REF_AUDIO_RULES["magi-2"]).toMatchObject({ formats: ["wav", "mp3"], convertsTo: "mp3", minSec: 2, maxSec: 30, maxTotalSec: 30 })
    expect(refVideoFormatProblem("magi-2", ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"])).toBeUndefined()
    expect(refVideoFormatProblem("magi-2", ["matroska", "webm"])).toMatch(/MP4 or MOV/)
    expect(refVideoFormatProblem("magi-2", undefined)).toBeUndefined()
    expect(refVideoFormatProblem("seedance-2-5-flash", ["matroska", "webm"])).toBeUndefined()
  })

  it("has a sound switch that costs nothing extra", () => {
    expect(getVideoAudioCapability("magi-2")).toMatchObject({ field: "generateAudio", defaultOn: true })
    expect(getVideoAudioCapability("magi-2").affectsCost).toBeUndefined()
  })

  it("is offered on Generate Video Pro, keyframes only", () => {
    expect((GVP_SUPPORTED_PROVIDERS as readonly string[]).includes("magi-2")).toBe(true)
    expect((GVP_EXTEND_PROVIDERS as readonly string[]).includes("magi-2")).toBe(false)
  })
})
