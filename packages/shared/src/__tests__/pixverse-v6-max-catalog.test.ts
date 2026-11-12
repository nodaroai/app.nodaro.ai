import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, defaultResolutionFor, modelMakerOf, normalizeVideoRequestParams } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_GEN_PROVIDERS,
  PIXVERSE_V6_MAX_PROVIDER,
  PIXVERSE_V6_MAX_DEFAULT_QUALITY,
  isPixverseV6MaxProvider,
  normalizePixverseV6MaxQuality,
  AUDIO_ADDON_PROVIDERS,
  DURATION_PRICED_PROVIDERS,
  RESOLUTION_DURATION_PRICING,
  PRICING_DEFAULT_RESOLUTION,
  VIDEO_DURATION_TIERS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_VARIABLE_PRICING,
  applyVideoAudioToggle,
  getVideoAudioCapability,
  videoAudioIntent,
  videoAudioPricedOn,
  GVP_SUPPORTED_PROVIDERS,
  GVP_EXTEND_PROVIDERS,
  GVP_END_FRAME_PROVIDERS,
  resolveGvpAnchorWire,
  videoModelCanSpeakDialogue,
  getMaxVideoPromptChars,
  pricedOutputDurationSec,
  videoProviderRequiresImage,
  videoProviderFoldsLoneEndFrame,
  isGvpSupportedProvider,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier, pricedVideoSelection, videoGenerationCreditId } from "../credit-identifiers.js"
import { uiAspectRatioFill, uiDurationFill, uiResolutionFill } from "../video-ui-defaults.js"
import { mapQuality } from "../node-default-mappings.js"

const ID = "pixverse-v6-max"
const DURATIONS = Array.from({ length: 15 }, (_, i) => i + 1)
const QUALITIES = ["360p", "540p", "720p", "1080p"] as const

describe("pixverse-v6-max catalog", () => {
  it("one id over both endpoints: text-to-video and image-to-video, 1-15s, 360p-1080p, native audio", () => {
    const m = MODEL_CATALOG[ID]!
    expect(isPixverseV6MaxProvider(ID)).toBe(true)
    expect(PIXVERSE_V6_MAX_PROVIDER).toBe(ID)
    expect([...m.modes].sort()).toEqual(["i2v", "t2v"])
    // No end frame, no reference images / videos / audio, no character subjects.
    expect([...(m.features ?? [])]).toEqual(["audio"])
    expect(m.durations).toEqual(DURATIONS)
    expect(m.defaultDuration).toBe(5)
    expect(m.resolutions).toEqual([...QUALITIES])
    expect(m.defaultResolution).toBe("720p")
    expect(m.unlistedResolutionRendersAs).toBe("720p")
    // Both schemas take a seed (0-2147483647).
    expect(m.noSeed).toBeUndefined()
    // The text-to-video enum, in KIE's order; the image-to-video body takes none.
    expect(m.aspectRatios).toEqual(["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"])
  })

  it("is made by PixVerse, a maker of its own", () => {
    expect(MODEL_MAKERS.pixverse).toEqual({ name: "PixVerse" })
    expect(modelMakerOf(MODEL_CATALOG[ID]!)).toEqual({ id: "pixverse", name: "PixVerse" })
    expect(MODEL_CATALOG[ID]!.family).toBe("PixVerse")
    expect(MODEL_CATALOG[ID]!.series).toBe("PixVerse")
  })

  it("is offered in both video lanes, runs without an image, and takes no references", () => {
    expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(VIDEO_GEN_PROVIDERS as readonly string[]).toContain(ID)
    expect(videoProviderRequiresImage(ID)).toBe(false)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER[ID]).toBeUndefined()
    expect(videoProviderFoldsLoneEndFrame(ID)).toBe(false)
  })

  it("joins Generate Video Pro through its explicit opt-in, keyframes only, with no end anchor", () => {
    expect(MODEL_CATALOG[ID]!.gvpWithoutReferences).toBe(true)
    expect(isGvpSupportedProvider(ID)).toBe(true)
    expect(GVP_SUPPORTED_PROVIDERS as readonly string[]).toContain(ID)
    expect(GVP_EXTEND_PROVIDERS as readonly string[]).not.toContain(ID)
    expect(GVP_END_FRAME_PROVIDERS as readonly string[]).not.toContain(ID)
  })

  it("a stored reference anchor choice runs as Auto in Generate Video Pro", () => {
    expect(resolveGvpAnchorWire("reference", ID)).toBeUndefined()
    expect(resolveGvpAnchorWire("start-end", ID)).toBe("upfront")
    expect(resolveGvpAnchorWire("start-only", ID)).toBe("progressive")
    // Every other model: "reference" still means none.
    expect(resolveGvpAnchorWire("reference", "seedance-2")).toBe("none")
    expect(resolveGvpAnchorWire("reference")).toBe("none")
  })

  it("caps the prompt at the schema's 5000 characters", () => {
    expect(getMaxVideoPromptChars(ID)).toBe(5000)
  })
})

describe("the native audio lever", () => {
  it("is cost-affecting, on by default and classified ambient (no live dialogue probe yet)", () => {
    const cap = getVideoAudioCapability(ID)
    expect(cap).toEqual({ mode: "ambient", field: "generateAudioSwitch", affectsCost: true, defaultOn: true, readsGenerateAudio: true })
    expect(AUDIO_ADDON_PROVIDERS.has(ID)).toBe(true)
    expect(videoModelCanSpeakDialogue(ID)).toBe(false)
  })

  it("writes generate_audio_switch from `sound`, else `generateAudio` — the reading its price follows", () => {
    for (const sound of [true, false]) {
      const input: Record<string, unknown> = {}
      applyVideoAudioToggle(input, ID, { sound })
      expect(input).toEqual({ generate_audio_switch: sound })
    }
    // The Generate Video Pro engine sends `generateAudio` alone.
    for (const generateAudio of [true, false]) {
      const input: Record<string, unknown> = {}
      applyVideoAudioToggle(input, ID, { generateAudio })
      expect(input).toEqual({ generate_audio_switch: generateAudio })
      expect(videoAudioIntent(ID, { generateAudio })).toBe(generateAudio)
    }
    // `sound` wins when both are sent.
    const both: Record<string, unknown> = {}
    applyVideoAudioToggle(both, ID, { sound: false, generateAudio: true })
    expect(both).toEqual({ generate_audio_switch: false })
    // The price reads the same: on with no intent, else the intent.
    expect(videoAudioPricedOn(ID, {})).toBe(true)
    expect(videoAudioPricedOn(ID, { generateAudio: false })).toBe(false)
    expect(videoAudioPricedOn(ID, { sound: true, generateAudio: false })).toBe(true)
    // No intent leaves the caller's own base value in place.
    const base: Record<string, unknown> = { generate_audio_switch: true }
    applyVideoAudioToggle(base, ID, undefined)
    expect(base).toEqual({ generate_audio_switch: true })
  })
})

describe("one quality normalizer for the wire and the bill", () => {
  it("folds case and collapses anything else to 720p", () => {
    expect(PIXVERSE_V6_MAX_DEFAULT_QUALITY).toBe("720p")
    expect(normalizePixverseV6MaxQuality("1080P")).toBe("1080p")
    expect(normalizePixverseV6MaxQuality(" 540p ")).toBe("540p")
    expect(normalizePixverseV6MaxQuality("360p")).toBe("360p")
    for (const off of [undefined, "", "480p", "4k", "2k", "nonsense"]) {
      expect(normalizePixverseV6MaxQuality(off), String(off)).toBe("720p")
    }
  })

  it("the catalog's collapse target is the normalizer's", () => {
    for (const off of ["480p", "4k", "nonsense"]) {
      expect(normalizeVideoRequestParams(ID, { resolution: off }).resolution, off).toBe(MODEL_CATALOG[ID]!.unlistedResolutionRendersAs)
    }
  })

  it("the credit identifier bills what the runner renders, for every spelling", () => {
    const cases: Array<[string | undefined, string]> = [
      ["1080P", "1080p"], ["540P", "540p"], ["360p", "360p"], ["720p", "720p"],
      [undefined, "720p"], ["480p", "720p"], ["4k", "720p"], ["nonsense", "720p"],
    ]
    for (const [asked, billed] of cases) {
      expect(normalizePixverseV6MaxQuality(asked)).toBe(billed)
      expect(buildVideoCreditModelIdentifier(ID, 5, false, "image-to-video", undefined, asked)).toBe(`${ID}:5s:${billed}`)
    }
  })
})

describe("the credit identifier", () => {
  it("is one row per second × quality, with `:audio` last when audio is on — and on when unset", () => {
    for (const d of DURATIONS) {
      for (const q of QUALITIES) {
        for (const mode of ["image-to-video", "text-to-video"] as const) {
          expect(buildVideoCreditModelIdentifier(ID, d, false, mode, undefined, q)).toBe(`${ID}:${d}s:${q}`)
          expect(buildVideoCreditModelIdentifier(ID, d, true, mode, undefined, q)).toBe(`${ID}:${d}s:${q}:audio`)
          expect(buildVideoCreditModelIdentifier(ID, d, undefined, mode, undefined, q)).toBe(`${ID}:${d}s:${q}:audio`)
        }
      }
    }
  })

  it("an unset request is the 5s 720p render with audio, and past 15s holds the top rung", () => {
    expect(buildVideoCreditModelIdentifier(ID)).toBe(`${ID}:5s:720p:audio`)
    expect(buildVideoCreditModelIdentifier(ID, 30, false, "text-to-video", undefined, "1080p")).toBe(`${ID}:15s:1080p`)
    expect(pricedOutputDurationSec(ID, undefined)).toBe(5)
  })

  it("reads the request's audio fields as the runner does: `sound`, else `generateAudio`, else on", () => {
    expect(buildVideoCreditModelIdentifier(ID, 5, { generateAudio: false }, "image-to-video", undefined, "720p")).toBe(`${ID}:5s:720p`)
    expect(buildVideoCreditModelIdentifier(ID, 5, { generateAudio: true }, "image-to-video", undefined, "720p")).toBe(`${ID}:5s:720p:audio`)
    expect(buildVideoCreditModelIdentifier(ID, 5, { sound: true, generateAudio: false }, "image-to-video", undefined, "720p")).toBe(`${ID}:5s:720p:audio`)
    expect(buildVideoCreditModelIdentifier(ID, 5, {}, "image-to-video", undefined, "720p")).toBe(`${ID}:5s:720p:audio`)
    expect(videoGenerationCreditId({ provider: ID, generateAudio: false })).toBe(`${ID}:5s:720p`)
  })

  it("Kling keeps reading `sound` alone: `generateAudio` moves none of its rows", () => {
    for (const generateAudio of [true, false, undefined]) {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10, { generateAudio }, "image-to-video")).toBe("kling-3.0:10s:audio")
      expect(buildVideoCreditModelIdentifier("kling", 5, { generateAudio }, "image-to-video")).toBe("kling:5s")
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10, { sound: false, generateAudio }, "image-to-video")).toBe("kling-3.0:10s")
    }
  })

  // A request that carries `generateAudio` alone — what a Generate Video Pro
  // segment's provider is handed (the render-rules `gvpSegmentAudio` mapping).
  it("a request carrying `generateAudio` alone is billed at the audio each model renders from it", () => {
    expect(buildVideoCreditModelIdentifier(ID, 6, { generateAudio: true }, "image-to-video", undefined, "720p")).toBe(`${ID}:6s:720p:audio`)
    expect(buildVideoCreditModelIdentifier(ID, 6, { generateAudio: false }, "image-to-video", undefined, "720p")).toBe(`${ID}:6s:720p`)
    expect(buildVideoCreditModelIdentifier(ID, 6, { generateAudio: undefined }, "image-to-video", undefined, "720p")).toBe(`${ID}:6s:720p:audio`)
    for (const generateAudio of [true, false, undefined]) {
      // Kling 3.0 reads only `sound`: its default, on. Kling 2.6: off.
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10, { generateAudio }, "image-to-video")).toBe("kling-3.0:10s:audio")
      expect(buildVideoCreditModelIdentifier("kling", 5, { generateAudio }, "image-to-video")).toBe("kling:5s")
    }
  })

  it("a model whose price does not depend on audio keeps its rows whatever the request's audio", () => {
    for (const other of ["seedance-2", "seedance-2-mini", "minimax-h3", "kling-4", "vidu-q4", "wan-3"]) {
      const silent = buildVideoCreditModelIdentifier(other, 8, false, "image-to-video", undefined, "720p")
      for (const generateAudio of [true, false, undefined]) {
        expect(buildVideoCreditModelIdentifier(other, 8, { generateAudio }, "image-to-video", undefined, "720p"), other).toBe(silent)
      }
    }
  })

  it("moving `:audio` after the other dimensions leaves Kling's rows where they were", () => {
    expect(buildVideoCreditModelIdentifier("kling-3.0", 10, true, "image-to-video")).toBe("kling-3.0:10s:audio")
    expect(buildVideoCreditModelIdentifier("kling-3.0", 5, undefined, "image-to-video")).toBe("kling-3.0:5s:audio")
    expect(buildVideoCreditModelIdentifier("kling-3.0", 15, false, "image-to-video")).toBe("kling-3.0:15s")
    expect(buildVideoCreditModelIdentifier("kling", 5, true, "image-to-video")).toBe("kling:5s:audio")
    expect(buildVideoCreditModelIdentifier("kling", 10, undefined, "image-to-video")).toBe("kling:10s")
  })

  it("is declared on every pricing table the builder reads", () => {
    expect(DURATION_PRICED_PROVIDERS.has(ID)).toBe(true)
    expect(RESOLUTION_DURATION_PRICING[ID]).toEqual([...QUALITIES])
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    expect(VIDEO_DURATION_TIERS[ID]!.map((t) => t.suffix)).toEqual(DURATIONS.map((d) => `${d}s`))
    expect(VIDEO_VARIABLE_PRICING[ID]).toBe("duration+resolution+audio")
  })
})

describe("defaults every surface reads", () => {
  it("an unset resolution and duration are 720p and 5s, never the 360p / 1s first entries", () => {
    expect(pricedVideoSelection({ provider: ID })).toEqual({ resolution: "720p", duration: 5, adjustments: [] })
    expect(pricedVideoSelection({ provider: ID, resolution: "360p", duration: 3 })).toEqual({ resolution: "360p", duration: 3, adjustments: [] })
    expect(uiResolutionFill(ID)).toBe("720p")
    expect(uiDurationFill(ID)).toBe(5)
    expect(defaultResolutionFor(ID)).toBe("720p")
    // No aspect fill: the text-to-video runner sends 16:9 (the first listed),
    // and an image-to-video run follows the image.
    expect(uiAspectRatioFill(ID)).toBeUndefined()
  })

  it("the quality rungs land on 540p / 720p / 1080p", () => {
    expect(mapQuality(ID, "low")).toEqual({ field: "resolution", value: "540p" })
    expect(mapQuality(ID, "mid")).toEqual({ field: "resolution", value: "720p" })
    expect(mapQuality(ID, "high")).toEqual({ field: "resolution", value: "1080p" })
  })
})

describe("the catalog's price rows follow the ladder", () => {
  it("each row is ceil(rate × seconds / 10) × 10 at its quality and audio rate", () => {
    // Base credits a second (KIE credits a second × 2.5, all whole numbers).
    const rate: Record<string, readonly [number, number]> = {
      "360p": [12, 18], "540p": [18, 22], "720p": [22, 30], "1080p": [44, 56],
    }
    const ladder = (q: string, s: number, audio: boolean) => Math.ceil((rate[q]![audio ? 1 : 0] * s) / 10) * 10
    for (const row of MODEL_CATALOG[ID]!.pricing) {
      const m = /^pixverse-v6-max(?::(\d+)s:(\d+p)(:audio)?)?$/.exec(row.identifier)
      expect(m, row.identifier).not.toBeNull()
      // The bare id is the default render: 5s 720p with audio.
      const [s, q, audio] = m![1] ? [Number(m![1]), m![2]!, m![3] !== undefined] : [5, "720p", true]
      expect(row.credits, row.identifier).toBe(ladder(q, s, audio))
    }
  })
})
