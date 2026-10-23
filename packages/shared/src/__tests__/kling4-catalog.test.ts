import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, hasFeature } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  KLING_4_PROVIDERS,
  isKling4Provider,
  normalizeKling4Resolution,
  kling4KeyframeFrameCap,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  videoProviderRequiresImage,
  videoProviderAppendsFrames,
  isGvpSupportedProvider,
  supportsExtendRender,
} from "../model-constants.js"
import { uiAspectRatioFill, uiDurationFill, uiResolutionFill } from "../video-ui-defaults.js"
import { characterReferencesFromWired, videoCharacterRefProblem } from "../video-character-refs.js"
import type { ConnectedReference } from "../types.js"

describe("kling-4 / kling-4-keyframes catalog", () => {
  it("two Kling-series ids, both modes, 3-30s, 720p/1080p, no seed", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      const m = MODEL_CATALOG[id]!
      expect(m.series).toBe("Kling") // ⇒ closed to the free tier (FREE_BLOCKED_VIDEO_SERIES)
      expect(m.maker).toBe("kuaishou")
      expect([...m.modes]).toEqual(["i2v", "t2v"])
      expect(m.durations).toEqual(Array.from({ length: 28 }, (_, i) => i + 3))
      expect(m.defaultDuration).toBe(5)
      expect(m.resolutions).toEqual(["720p", "1080p"])
      expect(m.noSeed).toBe(true)
      expect(m.aspectRatios).toEqual(["auto", "16:9", "9:16", "1:1", "21:9"])
      expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(id)
      expect(videoProviderRequiresImage(id)).toBe(false)
    }
    expect([...KLING_4_PROVIDERS]).toEqual(["kling-4", "kling-4-keyframes"])
    expect(isKling4Provider("kling-3.0")).toBe(false)
  })

  it("reference: subjects, voices and reference videos; keyframes: in-between frames on their own channel", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-4"]).toEqual({ images: 10, videos: 5, audio: 3, characters: 7, materials: 15 })
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS["kling-4"]).toEqual({ minSec: 2, maxSec: 30 })
    expect(hasFeature("kling-4", "character-subjects")).toBe(true)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-4-keyframes"]).toEqual({ images: 8 })
    expect(hasFeature("kling-4-keyframes", "keyframes")).toBe(true)
    expect(videoProviderAppendsFrames("kling-4")).toBe(true)
    expect(videoProviderAppendsFrames("kling-4-keyframes")).toBe(false)
  })

  it("Generate Video Pro offers kling-4 in keyframes mode only and never the Keyframes id", () => {
    expect(isGvpSupportedProvider("kling-4")).toBe(true)
    expect(supportsExtendRender("kling-4")).toBe(false)
    expect(isGvpSupportedProvider("kling-4-keyframes")).toBe(false)
  })

  it("the editor fills the rendered defaults: 720p, 5s, auto", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      expect(uiResolutionFill(id)).toBe("720p")
      expect(uiDurationFill(id)).toBe(5)
      expect(uiAspectRatioFill(id)).toBe("auto")
    }
  })

  it("normalizeKling4Resolution folds case and collapses anything else to 720p", () => {
    expect(normalizeKling4Resolution("1080P")).toBe("1080p")
    expect(normalizeKling4Resolution(" 1080p ")).toBe("1080p")
    for (const v of [undefined, "", "720p", "480p", "4k", "garbage"]) expect(normalizeKling4Resolution(v)).toBe("720p")
    expect(MODEL_CATALOG["kling-4"]!.unlistedResolutionRendersAs).toBe("720p")
  })

  it("kling4KeyframeFrameCap is KIE's table: 3s → 4 … 8s → 9, 9s or longer → 10", () => {
    expect([3, 4, 5, 6, 7, 8, 9, 15, 30].map(kling4KeyframeFrameCap)).toEqual([4, 5, 6, 7, 8, 9, 10, 10, 10])
    expect(kling4KeyframeFrameCap(Number.NaN)).toBe(6)
  })
})

describe("characterReferencesFromWired", () => {
  const ref = (over: Partial<ConnectedReference>): ConnectedReference => ({
    id: "x",
    defaultName: "Maya",
    source: "wired-character",
    url: "https://cdn.example/maya.png",
    characterSlug: "maya",
    ...over,
  })

  it("groups one character's entries: the canonical portrait first, then up to 3 views", () => {
    const out = characterReferencesFromWired([
      ref({ id: "v1", defaultName: "Maya / smile", url: "https://cdn.example/smile.png", variantSlug: "smile" }),
      ref({ id: "c", characterCanonicalDescription: "Short silver hair" }),
      ref({ id: "v2", defaultName: "Maya / side", url: "https://cdn.example/side.png", variantSlug: "side" }),
      ref({ id: "v3", defaultName: "Maya / back", url: "https://cdn.example/back.png", variantSlug: "back" }),
      ref({ id: "v4", defaultName: "Maya / walk", url: "https://cdn.example/walk.png", variantSlug: "walk" }),
      ref({ id: "k", defaultName: "Kira", characterSlug: "kira", url: "https://cdn.example/kira.png", description: "Tall" }),
    ])
    expect(out).toEqual([
      {
        imageUrl: "https://cdn.example/maya.png",
        extraImageUrls: ["https://cdn.example/smile.png", "https://cdn.example/side.png", "https://cdn.example/back.png"],
        description: "Short silver hair",
        name: "Maya",
      },
      { imageUrl: "https://cdn.example/kira.png", description: "Tall", name: "Kira" },
    ])
  })

  it("skips anything that is not a wired character", () => {
    expect(characterReferencesFromWired([ref({ source: "manual" as ConnectedReference["source"] })])).toEqual([])
  })
})

describe("videoCharacterRefProblem — Kling 4.0's 15-material budget", () => {
  const chars = (n: number) => Array.from({ length: n }, (_, i) => ({ imageUrl: `https://cdn.example/${i}.png`, description: "x" }))

  it("takes characters beside a start frame (it joins the images)", () => {
    expect(videoCharacterRefProblem({ provider: "kling-4", characterReferences: chars(2), imageCount: 1, videoCount: 0, hasStartFrame: true })).toBeNull()
  })

  it("refuses more than 15 materials in all and more than 7 characters", () => {
    expect(videoCharacterRefProblem({ provider: "kling-4", characterReferences: chars(7), imageCount: 4, videoCount: 3, audioCount: 1, hasStartFrame: true })?.code).toBe("character_references_quota")
    expect(videoCharacterRefProblem({ provider: "kling-4", characterReferences: chars(8), imageCount: 0, videoCount: 0, hasStartFrame: false })?.code).toBe("character_references_over_limit")
  })

  it("refuses a Gemini preset voice (Kling takes recorded voices as reference audio)", () => {
    const voiced = [{ ...chars(1)[0]!, voice: { preset: "Kore" as never } }]
    expect(videoCharacterRefProblem({ provider: "kling-4", characterReferences: voiced, imageCount: 0, videoCount: 0, hasStartFrame: false })?.code).toBe("character_voice_unsupported")
  })
})
