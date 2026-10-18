import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, MODEL_MAKERS, normalizeVideoRequestParams } from "../model-catalog.js"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_PROVIDERS_REQUIRING_IMAGE,
  getVideoAudioCapability,
  defaultVideoAspectRatio,
  getMaxVideoPromptChars,
  VIDU_Q4_PROVIDERS,
  isViduQ4Provider,
  VIDU_Q4_DEFAULT_RESOLUTION,
  normalizeViduQ4Resolution,
  isWan3Provider,
  isSeedance2Provider,
  isMinimaxH3Provider,
  DURATION_PRICED_PROVIDERS,
  VIDEO_DURATION_TIERS,
  RESOLUTION_DURATION_PRICING,
  PRICING_DEFAULT_RESOLUTION,
  NATIVE_ADAPTIVE_ASPECT,
  VIDEO_REF_AUDIO_RULES,
  checkRefAudioRules,
  resolveVideoModeForInputs,
  videoProviderFoldsLoneEndFrame,
  GVP_EXTEND_PROVIDERS,
} from "../model-constants.js"
import { buildVideoCreditModelIdentifier, videoGenerationCreditId } from "../credit-identifiers.js"
import { uiDurationFill, uiResolutionFill } from "../video-ui-defaults.js"

const ID = "vidu-q4"
const DURATIONS_3_TO_16 = Array.from({ length: 14 }, (_, i) => i + 3)
const RESOLUTIONS = ["540p", "720p", "1080p", "2k", "4k"] as const

describe("vidu-q4 catalog", () => {
  const entry = MODEL_CATALOG[ID]!

  it("is ONE i2v-only id made by ShengShu (no t2v mode exists on KIE)", () => {
    expect(entry.kind).toBe("video")
    expect([...entry.modes]).toEqual(["i2v"])
    expect(entry.label).toBe("Vidu Q4")
    expect(entry.series).toBe("Vidu")
    expect(entry.maker).toBe("shengshu")
    expect(MODEL_MAKERS.shengshu.name).toBe("ShengShu")
  })

  it("lists resolutions ASCENDING with lowercase 2k/4k; the 720p default is declared, not index 0", () => {
    expect(entry.resolutions).toEqual([...RESOLUTIONS])
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    expect(VIDU_Q4_DEFAULT_RESOLUTION).toBe("720p")
    expect(entry.unlistedResolutionRendersAs).toBe("720p")
  })

  it("offers every integer second 3-16 with a 5s default", () => {
    expect(entry.durations).toEqual(DURATIONS_3_TO_16)
    expect(entry.defaultDuration).toBe(5)
  })

  it("carries the reference-to-video ratio enum and takes no seed", () => {
    expect(entry.aspectRatios).toEqual(["16:9", "9:16", "1:1", "4:3", "3:4"])
    expect(entry.noSeed).toBe(true)
  })

  it("declares audio + reference-image + reference-to-video, and NOT end-frame or video-reference", () => {
    // reference-to-video: the reference endpoint runs from reference images
    // alone (no start frame), so a references-only run is never image-gated.
    expect([...(entry.features ?? [])].sort()).toEqual(["audio", "reference-image", "reference-to-video"])
  })
})

describe("vidu-q4 capability sets", () => {
  it("is in both route enums and image-gated on the t2v route", () => {
    expect(IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(TEXT_TO_VIDEO_PROVIDERS as readonly string[]).toContain(ID)
    expect(VIDEO_PROVIDERS_REQUIRING_IMAGE.has(ID)).toBe(true)
  })

  it("routes a start frame to image-to-video and a prompt-only run to the gated t2v lane", () => {
    expect(resolveVideoModeForInputs(ID, { hasStartFrame: true, hasImageRefs: false })).toBe("image-to-video")
    expect(resolveVideoModeForInputs(ID, { hasStartFrame: true, hasImageRefs: true })).toBe("image-to-video")
    expect(resolveVideoModeForInputs(ID, { hasStartFrame: false, hasImageRefs: false })).toBe("text-to-video")
  })

  it("has no home for a lone end frame (no fold into the references)", () => {
    expect(videoProviderFoldsLoneEndFrame(ID)).toBe(false)
  })

  it("carries 15 reference images and 3 reference audio clips, no reference videos", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER[ID]).toEqual({ images: 15, audio: 3 })
  })

  it("audio: ambient behind the model's own `audio` boolean, default on, not cost-affecting", () => {
    expect(getVideoAudioCapability(ID)).toEqual({ mode: "ambient", field: "audio", defaultOn: true })
  })

  it("keeps the historical 16:9 aspect default (no adaptive token on its enum)", () => {
    expect(defaultVideoAspectRatio(ID)).toBe("16:9")
    expect(NATIVE_ADAPTIVE_ASPECT[ID]).toBeUndefined()
  })

  it("prompt cap is the documented 20000 chars", () => {
    expect(getMaxVideoPromptChars(ID)).toBe(20000)
  })

  it("is a family of its own", () => {
    expect([...VIDU_Q4_PROVIDERS]).toEqual([ID])
    expect(isViduQ4Provider(ID)).toBe(true)
    expect(isViduQ4Provider("vidu")).toBe(false)
    expect(isViduQ4Provider(undefined)).toBe(false)
    expect(isWan3Provider(ID) || isSeedance2Provider(ID) || isMinimaxH3Provider(ID)).toBe(false)
  })

  it("renders keyframes only in generate-video-pro (no video-reference feature)", () => {
    expect(GVP_EXTEND_PROVIDERS as readonly string[]).not.toContain(ID)
  })

  it("fills the 720p / 5s defaults rather than the ladder's first rung", () => {
    expect(uiResolutionFill(ID)).toBe("720p")
    expect(uiDurationFill(ID)).toBe(5)
  })
})

describe("normalizeViduQ4Resolution", () => {
  it("keeps every supported tier, case-insensitively, in the lowercase wire spelling", () => {
    for (const r of RESOLUTIONS) {
      expect(normalizeViduQ4Resolution(r)).toBe(r)
      expect(normalizeViduQ4Resolution(r.toUpperCase())).toBe(r)
    }
    expect(normalizeViduQ4Resolution(" 2K ")).toBe("2k")
  })

  it("collapses undefined / garbage / an off-menu tier to the 720p default", () => {
    for (const v of [undefined, "", "480p", "8k", "nonsense"]) {
      expect(normalizeViduQ4Resolution(v)).toBe("720p")
    }
  })

  it("the catalog funnel canonicalises an uppercase 2K/4K to the lowercase band", () => {
    expect(normalizeVideoRequestParams(ID, { resolution: "4K" }).resolution).toBe("4k")
    expect(normalizeVideoRequestParams(ID, { resolution: "2K" }).resolution).toBe("2k")
  })
})

describe("vidu-q4 credit identifier", () => {
  it("is duration-priced with one tier per allowed second 3-16", () => {
    expect(DURATION_PRICED_PROVIDERS.has(ID)).toBe(true)
    expect(VIDEO_DURATION_TIERS[ID]!.map((t) => t.maxSeconds)).toEqual(DURATIONS_3_TO_16)
    expect(RESOLUTION_DURATION_PRICING[ID]).toEqual([...RESOLUTIONS])
  })

  it("emits exactly one composite per (duration, resolution) pair — 70 distinct ids", () => {
    const ids = new Set<string>()
    for (const d of DURATIONS_3_TO_16) {
      for (const r of RESOLUTIONS) {
        const id = buildVideoCreditModelIdentifier(ID, d, undefined, "image-to-video", undefined, r)
        expect(id).toBe(`${ID}:${d}s:${r}`)
        ids.add(id)
      }
    }
    expect(ids.size).toBe(70)
  })

  it("prices an OMITTED resolution and duration at the declared 5s 720p default", () => {
    expect(buildVideoCreditModelIdentifier(ID, undefined, undefined, "image-to-video")).toBe("vidu-q4:5s:720p")
    expect(videoGenerationCreditId({ provider: ID })).toBe("vidu-q4:5s:720p")
  })

  it("bills the tier it RENDERS for every spelling, and 720p for anything unknown", () => {
    expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, "4K")).toBe("vidu-q4:8s:4k")
    expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, "480p")).toBe("vidu-q4:8s:720p")
    expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, "nonsense")).toBe("vidu-q4:8s:720p")
  })

  it("has no audio and no reference dimension — one ladder for both endpoints", () => {
    const plain = buildVideoCreditModelIdentifier(ID, 6, undefined, "image-to-video", undefined, "1080p")
    expect(buildVideoCreditModelIdentifier(ID, 6, true, "image-to-video", undefined, "1080p")).toBe(plain)
    expect(buildVideoCreditModelIdentifier(ID, 6, false, "image-to-video", undefined, "1080p")).toBe(plain)
    expect(buildVideoCreditModelIdentifier(ID, 6, undefined, "image-to-video", undefined, "1080p", true)).toBe(plain)
  })

  it("snaps an off-menu duration into a seeded tier", () => {
    expect(buildVideoCreditModelIdentifier(ID, 2, undefined, "image-to-video", undefined, "720p")).toBe("vidu-q4:3s:720p")
    expect(buildVideoCreditModelIdentifier(ID, 40, undefined, "image-to-video", undefined, "720p")).toBe("vidu-q4:16s:720p")
  })

  it("every catalog pricing row is an id the builder can emit (or the bare default)", () => {
    const emittable = new Set<string>([ID])
    for (const d of DURATIONS_3_TO_16) for (const r of RESOLUTIONS) emittable.add(`${ID}:${d}s:${r}`)
    for (const row of MODEL_CATALOG[ID]!.pricing) expect(emittable.has(row.identifier), row.identifier).toBe(true)
  })
})

describe("vidu-q4 reference-audio rules", () => {
  it("declares MP3-only clips of 3-12 seconds", () => {
    expect(VIDEO_REF_AUDIO_RULES[ID]).toEqual({ formats: ["mp3"], minSec: 3, maxSec: 12 })
  })

  it("accepts MP3 clips inside the window", () => {
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 3 }, { formatNames: ["mp3"], durationSec: 12 }])).toEqual({ ok: true })
  })

  it("refuses a non-MP3 clip with the format code", () => {
    const r = checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 5 }, { formatNames: ["wav"], durationSec: 5 }])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("audio_format_unsupported")
      expect(r.message).toContain("Reference audio 2")
      expect(r.message).toContain("MP3")
    }
    const m4a = checkRefAudioRules(ID, [{ formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"], durationSec: 5 }])
    expect(m4a.ok).toBe(false)
  })

  it("refuses a clip outside 3-12 seconds", () => {
    const short = checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 2.5 }])
    expect(short.ok === false && short.code).toBe("audio_too_short")
    const long = checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 12.4 }])
    expect(long.ok === false && long.code).toBe("audio_too_long")
  })

  it("ignores whatever a probe could not read — a blip never blocks a run", () => {
    expect(checkRefAudioRules(ID, [{}, { durationSec: Number.NaN }, { formatNames: [] }])).toEqual({ ok: true })
  })

  it("is a no-op for a provider with no declared rule", () => {
    expect(checkRefAudioRules("wan-3", [{ formatNames: ["wav"], durationSec: 1 }])).toEqual({ ok: true })
    expect(checkRefAudioRules(undefined, [{ formatNames: ["wav"] }])).toEqual({ ok: true })
  })
})
