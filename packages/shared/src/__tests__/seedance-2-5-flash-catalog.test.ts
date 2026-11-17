import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, normalizeVideoRequestParams } from "../model-catalog.js"
import {
  EDIT_VIDEO_PRO_HELD_BACK_PROVIDERS,
  FRAME_MODE_ADAPTIVE_ONLY_ASPECT,
  IMAGE_TO_VIDEO_PROVIDERS,
  LIP_SYNC_PROVIDERS,
  NATIVE_ADAPTIVE_ASPECT,
  PRICING_DEFAULT_RESOLUTION,
  PROMPT_HARD_CEILING,
  SEEDANCE_2_5_FLASH_REF_LIMITS,
  SEEDANCE_LIP_SYNC_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  VIDEO_DURATION_TIERS,
  VIDEO_REF_AUDIO_RULES,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  VIDEO_TO_VIDEO_NODE_PROVIDERS,
  billsReferenceVideoSeconds,
  checkRefAudioRules,
  getMaxVideoPromptChars,
  isEditVideoProProvider,
  isSeedance2Provider,
  isSeedanceVideoEditProvider,
  editVideoProProviderRefusal,
  seedance2AudioLimitSec,
  trimVideoReferencesToLimits,
  videoReferencesOverLimitProblem,
  supportsAutoVideoDuration,
} from "../model-constants.js"
import { SEEDANCE_DRAFT_MODELS, isSeedanceDraftCapable } from "../seedance-draft.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

const ID = "seedance-2-5-flash"

/**
 * Seedance 2.5 Flash — the fast tier of Seedance 2.5, from its own KIE schema
 * (docs.kie.ai/market/bytedance/seedance-2-5-flash). Its id EXTENDS
 * `seedance-2-5`, so every family set and prefix match is pinned here: it
 * shares the family's behaviour, never 2.5's own facts (1080p, 30/10/10
 * references, the 30000-char prompt, draft and the HD finalize).
 */
describe("seedance-2-5-flash catalog", () => {
  it("is a ByteDance video model beside Seedance 2.5, with its own label", () => {
    const m = MODEL_CATALOG[ID]!
    expect(m.kind).toBe("video")
    expect(m.label).toBe("Seedance 2.5 Flash")
    expect(m.maker).toBe("bytedance")
    expect(m.modes).toEqual(["i2v", "t2v", "v2v"])
    expect(m.noSeed).toBe(true)
    expect(m.referenceTaskTypes).toEqual(["reference", "edit", "extend"])
  })

  it("is 480p/720p only — never Seedance 2.5's 1080p — and defaults to 720p for pricing", () => {
    expect(MODEL_CATALOG[ID]!.resolutions).toEqual(["480p", "720p"])
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    // A stale 1080p (copied from a 2.5 node) is moved before it is priced or sent.
    expect(normalizeVideoRequestParams(ID, { resolution: "1080p" }).resolution).toBe("720p")
  })

  it("runs 4-30s, one price tier per second, and takes Auto length", () => {
    const d = MODEL_CATALOG[ID]!.durations!
    expect(d[0]).toBe(4)
    expect(d[d.length - 1]).toBe(30)
    expect(d).toHaveLength(27)
    expect(MODEL_CATALOG[ID]!.defaultDuration).toBe(8)
    expect(VIDEO_DURATION_TIERS[ID]).toHaveLength(27)
    expect(supportsAutoVideoDuration(ID)).toBe(true)
  })

  it("takes 10 images / 5 videos / 5 audio references — not 2.5's 30/10/10, not the 2.0 family's 9/3/3", () => {
    expect(SEEDANCE_2_5_FLASH_REF_LIMITS).toEqual({ images: 10, videos: 5, audio: 5 })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER[ID]).toEqual({ images: 10, videos: 5, audio: 5, requestRefusesOverLimit: true })
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS[ID]).toEqual({ minSec: 2, maxSec: 30, maxTotalSec: 30 })
    expect(seedance2AudioLimitSec(ID)).toBe(30)
  })

  it("converts reference audio that is not WAV or MP3 (never refused for its format), and refuses a clip outside 2-30s or more than 30s together", () => {
    expect(VIDEO_REF_AUDIO_RULES[ID]).toEqual({ formats: ["wav", "mp3"], convertsTo: "mp3", minSec: 2, maxSec: 30, maxTotalSec: 30 })
    expect(VIDEO_REF_AUDIO_RULES["seedance-2-5"]).toBeUndefined()
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 5 }])).toEqual({ ok: true })
    expect(checkRefAudioRules(ID, [{ formatNames: ["wav"], durationSec: 5 }])).toEqual({ ok: true })
    expect(checkRefAudioRules(ID, [{ formatNames: ["mov", "mp4", "m4a"], durationSec: 5 }])).toEqual({ ok: true })
    expect(checkRefAudioRules(ID, [{ formatNames: ["ogg"], durationSec: 5 }])).toEqual({ ok: true })
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 1.5 }])).toMatchObject({ ok: false, code: "audio_too_short" })
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 31 }])).toMatchObject({ ok: false, code: "audio_too_long" })
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 20 }, { formatNames: ["m4a"], durationSec: 11 }])).toMatchObject({ ok: false, code: "audio_total_too_long" })
    expect(checkRefAudioRules(ID, [{ formatNames: ["mp3"], durationSec: 15 }, { formatNames: ["m4a"], durationSec: 15 }])).toEqual({ ok: true })
    // A rule without the conversion still refuses the format (Vidu Q4).
    expect(checkRefAudioRules("vidu-q4", [{ formatNames: ["wav"], durationSec: 5 }])).toMatchObject({ ok: false, code: "audio_format_unsupported" })
  })

  it("forces adaptive aspect on frame requests (documented for Flash)", () => {
    expect(FRAME_MODE_ADAPTIVE_ONLY_ASPECT.has(ID)).toBe(true)
    expect(NATIVE_ADAPTIVE_ASPECT[ID]).toBe("adaptive")
  })

  it("keeps its own 20480-char prompt limit, under the route ceiling", () => {
    expect(getMaxVideoPromptChars(ID)).toBe(20480)
    expect(getMaxVideoPromptChars("seedance-2-5")).toBe(30000)
    expect(PROMPT_HARD_CEILING).toBeGreaterThanOrEqual(20480)
  })
})

describe("seedance-2-5-flash — the family it joins, and what it never inherits", () => {
  it("joins the Seedance 2 family, reference-video billing, the edit lane and the lip-sync menu", () => {
    expect(isSeedance2Provider(ID)).toBe(true)
    expect(billsReferenceVideoSeconds(ID)).toBe(true)
    expect(isSeedanceVideoEditProvider(ID)).toBe(true)
    expect((VIDEO_TO_VIDEO_NODE_PROVIDERS as readonly string[]).includes(ID)).toBe(true)
    expect((LIP_SYNC_PROVIDERS as readonly string[]).includes(ID)).toBe(true)
    expect(SEEDANCE_LIP_SYNC_PROVIDERS.has(ID)).toBe(true)
  })

  it("is on both route provider lists (it runs from text and from a frame)", () => {
    expect((TEXT_TO_VIDEO_PROVIDERS as readonly string[]).includes(ID)).toBe(true)
    expect((IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).includes(ID)).toBe(true)
  })

  it("has no draft mode and no HD finalize", () => {
    expect(isSeedanceDraftCapable(ID)).toBe(false)
    expect(SEEDANCE_DRAFT_MODELS as readonly string[]).not.toContain(ID)
    // A draft flag on a Flash request is ignored: priced and sent at the resolution asked.
    expect(normalizeVideoRequestParams(ID, { resolution: "720p", draft: true }).resolution).toBe("720p")
  })

  it("is held back from Edit Video Pro (a separate decision); the rest of the family is not", () => {
    expect(EDIT_VIDEO_PRO_HELD_BACK_PROVIDERS.has(ID)).toBe(true)
    expect(isEditVideoProProvider(ID)).toBe(false)
    for (const p of ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]) {
      expect(isEditVideoProProvider(p), p).toBe(true)
    }
  })
})

describe("seedance-2-5-flash pricing identifiers", () => {
  const build = (duration?: number, resolution?: string, hasVideoRef?: boolean) =>
    buildVideoCreditModelIdentifier(ID, duration, undefined, undefined, undefined, resolution, hasVideoRef)

  it("prices its own rows, never Seedance 2.5's", () => {
    expect(build(8, "720p")).toBe("seedance-2-5-flash:8s:720p")
    expect(build(23, "480p")).toBe("seedance-2-5-flash:23s:480p")
    expect(build(8, "720p", true)).toBe("seedance-2-5-flash:8s:720p-ref")
  })

  it("prices an omitted resolution at 720p and clamps 1080p / 4k to 720p — no 1080p row exists", () => {
    expect(build(8)).toBe("seedance-2-5-flash:8s:720p")
    expect(build(8, "1080p")).toBe("seedance-2-5-flash:8s:720p")
    expect(build(8, "4k", true)).toBe("seedance-2-5-flash:8s:720p-ref")
  })

  it("resolves every duration x resolution x ref-mode to its own id (108 in all)", () => {
    const seen = new Set<string>()
    for (const d of MODEL_CATALOG[ID]!.durations!) {
      for (const res of ["480p", "720p"]) {
        for (const ref of [false, true]) {
          const id = build(d, res, ref)
          expect(id).toBe(`${ID}:${d}s:${res}${ref ? "-ref" : ""}`)
          seen.add(id)
        }
      }
    }
    expect(seen.size).toBe(108)
  })
})

describe("seedance-2-5-flash — too many references (decided 2026-11-16)", () => {
  it("a direct request over 10 / 5 / 5 is refused with the limit named; a frame counts toward the images once a reference is sent", () => {
    expect(videoReferencesOverLimitProblem(ID, { images: 10, videos: 5, audio: 5 })).toBeUndefined()
    expect(videoReferencesOverLimitProblem(ID, { images: 11, videos: 0, audio: 0 })).toMatch(/at most 10 reference images; this request sends 11\. Remove 1\./)
    expect(videoReferencesOverLimitProblem(ID, { images: 0, videos: 6, audio: 0 })).toMatch(/at most 5 reference videos/)
    expect(videoReferencesOverLimitProblem(ID, { images: 0, videos: 0, audio: 6 })).toMatch(/at most 5 reference audio clips/)
    expect(videoReferencesOverLimitProblem(ID, { images: 10, videos: 0, audio: 0, frames: 1 })).toMatch(/sends 11/)
    // Frames alone (no reference) are frames, not references.
    expect(videoReferencesOverLimitProblem(ID, { images: 0, videos: 0, audio: 0, frames: 2 })).toBeUndefined()
  })

  it("every other model keeps the provider's trim (nothing refused here)", () => {
    for (const p of ["seedance-2", "seedance-2-5", "kling-4", "wan-3"]) {
      expect(videoReferencesOverLimitProblem(p, { images: 99, videos: 99, audio: 99 }), p).toBeUndefined()
    }
  })

  it("the editor's Run sends the first references up to the caps, less the frames that join the images", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => `u${i}`)
    expect(trimVideoReferencesToLimits(ID, { images: n(12), videos: n(7), audio: n(6), frames: 1 })).toEqual({ images: n(9), videos: n(5), audio: n(5) })
    expect(trimVideoReferencesToLimits("seedance-2-5", { images: n(40), videos: n(12) })).toEqual({ images: n(40), videos: n(12), audio: undefined })
  })

  it("Edit Video Pro refuses Flash with one sentence, and offers the rest of the family", () => {
    expect(editVideoProProviderRefusal(ID)).toBe("seedance-2-5-flash is not offered on Edit Video Pro. Pick another Edit Video Pro model.")
    for (const p of ["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]) expect(editVideoProProviderRefusal(p), p).toBeUndefined()
  })
})
