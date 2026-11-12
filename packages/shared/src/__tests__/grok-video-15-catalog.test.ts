import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, hasFeature } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  GROK_VIDEO_15_PROVIDER,
  GROK_VIDEO_15_MAX_MIDDLE_FRAMES,
  isGrokVideo15Provider,
  normalizeGrokVideo15Resolution,
  grokVideo15MiddleFrameSlots,
  videoKeyframesMiddleCap,
  kling4KeyframeFrameCap,
  KLING_4_MAX_MIDDLE_FRAMES,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL,
  RESOLUTION_DURATION_PRICING,
  PRICING_DEFAULT_RESOLUTION,
  videoProviderRequiresImage,
  videoProviderAppendsFrames,
  videoProviderRunsFromReferences,
  videoProviderTakesLoneEndFrame,
  videoProviderRefsReplaceStartFrame,
  videoProviderFoldsLoneEndFrame,
  isGeminiOmniPerSecondProvider,
  resolveVideoModeForInputs,
  isGvpSupportedProvider,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier, pricedVideoSelection } from "../credit-identifiers.js"
import { uiResolutionFill } from "../video-ui-defaults.js"
import { mapQuality } from "../node-default-mappings.js"

const ID = "grok-imagine-video-1.5"
const videoIds = Object.values(MODEL_CATALOG).filter((m) => m.kind === "video").map((m) => m.id)

describe("grok-imagine-video-1.5 catalog (frames, in-between frames, 1080p)", () => {
  it("an image-to-video model with an end frame and in-between frames, 1-15s at 480p / 720p / 1080p", () => {
    const m = MODEL_CATALOG[ID]!
    expect(isGrokVideo15Provider(ID)).toBe(true)
    expect(GROK_VIDEO_15_PROVIDER).toBe(ID)
    expect([...m.modes]).toEqual(["i2v"])
    expect([...(m.features ?? [])].sort()).toEqual(["end-frame", "keyframes", "reference-image"])
    // In-between frames need the start frame: no references-only mode.
    expect(videoProviderRunsFromReferences(ID)).toBe(false)
    expect(m.durations).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    expect(m.defaultDuration).toBe(8)
    expect(m.resolutions).toEqual(["480p", "720p", "1080p"])
    expect(m.noSeed).toBe(true)
    // Unchanged by this model's frames: the ratio list and the lanes it is in.
    expect(m.aspectRatios).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4"])
    expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(videoProviderRequiresImage(ID)).toBe(true)
  })

  it("the in-between frames ride their own channel, at most 4, and keep the model out of generate-video-pro", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER[ID]).toEqual({ images: GROK_VIDEO_15_MAX_MIDDLE_FRAMES })
    expect(GROK_VIDEO_15_MAX_MIDDLE_FRAMES).toBe(4)
    expect(VIDEO_PROVIDERS_WITH_SEPARATE_FRAME_CHANNEL.has(ID)).toBe(true)
    expect(videoProviderAppendsFrames(ID)).toBe(false)
    expect(isGvpSupportedProvider(ID)).toBe(false)
  })

  it("480p stays the default: the first priced tier, the collapse target and the bare id's tier", () => {
    expect(RESOLUTION_DURATION_PRICING[ID]).toEqual(["480p", "720p", "1080p"])
    expect(MODEL_CATALOG[ID]!.unlistedResolutionRendersAs).toBe("480p")
    expect(normalizeGrokVideo15Resolution(undefined)).toBe("480p")
    expect(buildVideoCreditModelIdentifier(ID)).toBe(`${ID}:8s:480p`)
  })

  it("an unset resolution is 480p for every reader of the declared default", () => {
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("480p")
    // The routes and the workflow run fill it (and send it), at the same price.
    expect(pricedVideoSelection({ provider: ID }).resolution).toBe("480p")
    expect(pricedVideoSelection({ provider: ID, resolution: "720p" }).resolution).toBe("720p")
    expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, undefined)).toBe(`${ID}:8s:480p`)
    // The editor's persisted fill is family-scoped and stays out of it: the
    // panel's own snap keeps 480p first.
    expect(uiResolutionFill(ID)).toBeUndefined()
  })

  it("the quality rungs land on the three tiers", () => {
    expect(mapQuality(ID, "low")).toEqual({ field: "resolution", value: "480p" })
    expect(mapQuality(ID, "mid")).toEqual({ field: "resolution", value: "720p" })
    expect(mapQuality(ID, "high")).toEqual({ field: "resolution", value: "1080p" })
  })
})

describe("one resolution normalizer for the wire and the bill", () => {
  it("folds case and collapses anything else to 480p", () => {
    expect(normalizeGrokVideo15Resolution("1080P")).toBe("1080p")
    expect(normalizeGrokVideo15Resolution(" 720p ")).toBe("720p")
    expect(normalizeGrokVideo15Resolution("480p")).toBe("480p")
    expect(normalizeGrokVideo15Resolution("4k")).toBe("480p")
    expect(normalizeGrokVideo15Resolution("")).toBe("480p")
  })

  it("the credit identifier bills what the runner renders, for every spelling", () => {
    const cases: Array<[string | undefined, string]> = [
      ["1080P", "1080p"],
      ["1080p", "1080p"],
      ["720P", "720p"],
      ["480p", "480p"],
      [undefined, "480p"],
      ["4k", "480p"],
      ["nonsense", "480p"],
    ]
    for (const [asked, billed] of cases) {
      expect(normalizeGrokVideo15Resolution(asked)).toBe(billed)
      expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, asked)).toBe(`${ID}:8s:${billed}`)
    }
  })

  it("prices every second 1-15 on its own row, the default 8s when unset", () => {
    for (let s = 1; s <= 15; s++) {
      expect(buildVideoCreditModelIdentifier(ID, s, undefined, "image-to-video", undefined, "720p")).toBe(`${ID}:${s}s:720p`)
    }
    expect(buildVideoCreditModelIdentifier(ID, undefined, undefined, "image-to-video", undefined, "1080p")).toBe(`${ID}:8s:1080p`)
  })
})

describe("in-between frame slots", () => {
  it("one per whole second inside the clip, at most 4", () => {
    const expected: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 8: 4, 15: 4 }
    for (const [seconds, slots] of Object.entries(expected)) {
      expect(grokVideo15MiddleFrameSlots(Number(seconds)), `${seconds}s`).toBe(slots)
    }
    // Unset renders the 8s default.
    expect(grokVideo15MiddleFrameSlots(undefined)).toBe(4)
  })

  it("the start and end frames take no slot on Grok, and share the cap on Kling 4.0 Keyframes", () => {
    for (const hasStartFrame of [false, true]) {
      for (const hasEndFrame of [false, true]) {
        expect(videoKeyframesMiddleCap(ID, 3, { hasStartFrame, hasEndFrame })).toBe(2)
        for (const seconds of [3, 5, 9, 30]) {
          const ends = (hasStartFrame ? 1 : 0) + (hasEndFrame ? 1 : 0)
          expect(videoKeyframesMiddleCap("kling-4-keyframes", seconds, { hasStartFrame, hasEndFrame }))
            .toBe(Math.max(0, Math.min(KLING_4_MAX_MIDDLE_FRAMES, kling4KeyframeFrameCap(seconds) - ends)))
        }
      }
    }
    expect(videoKeyframesMiddleCap("seedance-2", 8, { hasStartFrame: true, hasEndFrame: false })).toBeUndefined()
  })
})

describe("a lone end frame and references alone: Grok keeps the general rule", () => {
  it("Grok needs its start image: a lone end frame is not kept as the end, in-between frames do not replace it", () => {
    expect(videoProviderTakesLoneEndFrame(ID)).toBe(false)
    expect(videoProviderFoldsLoneEndFrame(ID)).toBe(false)
    expect(videoProviderRefsReplaceStartFrame(ID)).toBe(false)
    // The workflow run's mode resolver agrees: in-between frames alone go to the
    // text-to-video lane, whose image gate refuses the run.
    expect(resolveVideoModeForInputs(ID, { hasStartFrame: false, hasImageRefs: true })).toBe("text-to-video")
    expect(resolveVideoModeForInputs(ID, { hasStartFrame: true, hasImageRefs: true })).toBe("image-to-video")
  })

  it("every other model answers exactly as the rules these helpers replace did", () => {
    for (const id of videoIds) {
      if (id === ID) continue
      const oldTakesLoneEnd = hasFeature(id, "keyframes") || isGeminiOmniPerSecondProvider(id)
      expect(videoProviderTakesLoneEndFrame(id), id).toBe(oldTakesLoneEnd)
      const oldRefsCarried = (VIDEO_REF_LIMITS_BY_PROVIDER[id]?.images ?? 0) > 0
      expect(videoProviderRefsReplaceStartFrame(id), id).toBe(oldRefsCarried)
    }
    expect(videoProviderTakesLoneEndFrame("kling-4-keyframes")).toBe(true)
    expect(videoProviderTakesLoneEndFrame("gemini-omni-flash-1-2")).toBe(true)
  })
})

describe("the price ladder", () => {
  it("each catalog row is ceil(rate × seconds × 2.5 / 10) × 10 at the per-second rate of its resolution", () => {
    // Rates in tenths of a provider credit a second (integers, so no float lands
    // a boundary row one step up); the bare id is the 8s 480p row.
    const tenths: Record<string, number> = { "480p": 24, "720p": 45, "1080p": 80 }
    const ladder = (res: string, s: number) => Math.ceil((tenths[res]! * s * 25) / 1000) * 10
    for (const row of MODEL_CATALOG[ID]!.pricing) {
      const m = /^grok-imagine-video-1\.5(?::(\d+)s:(\d+p))?$/.exec(row.identifier)
      expect(m, row.identifier).not.toBeNull()
      const [s, res] = m![1] ? [Number(m![1]), m![2]!] : [8, "480p"]
      expect(row.credits, row.identifier).toBe(ladder(res, s))
    }
    expect(ladder("480p", 8)).toBe(50)
    expect(ladder("720p", 8)).toBe(90)
    expect(ladder("1080p", 8)).toBe(160)
    expect(ladder("480p", 15)).toBe(90)
    expect(ladder("720p", 15)).toBe(170)
    expect(ladder("1080p", 15)).toBe(300)
  })
})
