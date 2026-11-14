import { describe, expect, it } from "vitest"
import {
  characterReferencesFromWired,
  characterVideoUrls,
  pricedReferenceVideoUrls,
  seatCharacterVideos,
  videoCharacterClipsBilledAsReferenceVideo,
  videoCharacterVideoCap,
  videoCharacterVideoProviders,
} from "../entries/video.js"
import {
  VIDEO_CHARACTER_CLIP_DURATION_LIMITS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  checkCharacterClipDurations,
} from "../entries/models.js"
import { CHARACTER_NODE_DEFAULT_LABEL, wiredCharacterVideoUrls } from "../entries/entities.js"
import type { ConnectedReference } from "../types.js"

/**
 * Video subjects on Kling 4.0 / Kling 4.0 Flash (decided 2026-11-13): a
 * character made from a short clip of itself. KIE takes at most 3 of them,
 * counts them with the reference videos (5 in all) and bills their seconds as
 * reference-video seconds — so the clip is SEATED among the reference videos,
 * and every reference-video seam measures and prices it.
 */
const clip = (n: number) => `https://cdn.example/clip-${n}.mp4`
const ref = (n: number) => `https://cdn.example/ref-${n}.mp4`
const character = (videoUrl?: string) => ({ imageUrl: "https://cdn.example/p.png", description: "d", ...(videoUrl ? { videoUrl } : {}) })

describe("which models take video subjects (data)", () => {
  it("Kling 4.0 and Kling 4.0 Flash, 3 each; nothing else", () => {
    expect(videoCharacterVideoProviders()).toEqual(["kling-4", "kling-4-flash"])
    expect(videoCharacterVideoCap("kling-4")).toBe(3)
    expect(videoCharacterVideoCap("kling-4-flash")).toBe(3)
    expect(videoCharacterVideoCap("gemini-omni-video")).toBe(0)
    expect(videoCharacterVideoCap("seedance-2")).toBe(0)
    expect(videoCharacterVideoCap(undefined)).toBe(0)
  })

  it("a model that takes video subjects bills reference-video seconds and bounds a clip at 3-8 s", () => {
    for (const id of videoCharacterVideoProviders()) {
      expect(VIDEO_REF_VIDEO_DURATION_LIMITS[id], id).toBeDefined()
      expect(VIDEO_CHARACTER_CLIP_DURATION_LIMITS[id], id).toEqual({ minSec: 3, maxSec: 8 })
      expect(VIDEO_REF_LIMITS_BY_PROVIDER[id]?.videos, id).toBe(5)
    }
  })
})

// Decided 2026-11-14, from a measured run: Kling 4.0 Flash bills a video subject
// like an image subject; Kling 4.0 keeps pricing it as a reference video.
describe("how a video subject is priced, per model (data)", () => {
  it("Kling 4.0 bills it as reference video; Kling 4.0 Flash does not", () => {
    expect(videoCharacterClipsBilledAsReferenceVideo("kling-4")).toBe(true)
    expect(videoCharacterClipsBilledAsReferenceVideo("kling-4-flash")).toBe(false)
    expect(videoCharacterClipsBilledAsReferenceVideo(undefined)).toBe(false)
  })

  it("pricedReferenceVideoUrls: a character's clip leaves the priced list on Flash only; plain reference videos stay", () => {
    const seated = [ref(1), clip(1)]
    const characters = [character(clip(1)), character()]
    expect(pricedReferenceVideoUrls({ provider: "kling-4-flash", referenceVideoUrls: seated, characterReferences: characters })).toEqual([ref(1)])
    expect(pricedReferenceVideoUrls({ provider: "kling-4-flash", referenceVideoUrls: [clip(1)], characterReferences: characters })).toEqual([])
    const asSent = pricedReferenceVideoUrls({ provider: "kling-4", referenceVideoUrls: seated, characterReferences: characters })
    expect(asSent).toBe(seated)
    // Nothing to leave out: the same value.
    const plain = [ref(1)]
    expect(pricedReferenceVideoUrls({ provider: "kling-4-flash", referenceVideoUrls: plain, characterReferences: characters })).toBe(plain)
    expect(pricedReferenceVideoUrls({ provider: "kling-4-flash", referenceVideoUrls: undefined, characterReferences: undefined })).toBeUndefined()
  })
})

describe("seatCharacterVideos — a character's clip rides as one more reference video", () => {
  it("no clip: the list as it came, the same value — within the model's cap", () => {
    const refs = [ref(1)]
    const out = seatCharacterVideos({ provider: "kling-4", referenceVideoUrls: refs, characterReferences: [character()] })
    expect(out).toEqual({ ok: true, referenceVideoUrls: refs })
    expect(out.ok && out.referenceVideoUrls).toBe(refs)
    expect(seatCharacterVideos({ provider: "seedance-2", referenceVideoUrls: undefined, characterReferences: undefined })).toEqual({ ok: true, referenceVideoUrls: undefined })
  })

  it("clips follow the reference videos, in character order", () => {
    expect(seatCharacterVideos({ provider: "kling-4-flash", referenceVideoUrls: [ref(1)], characterReferences: [character(clip(1)), character(), character(clip(2))] }))
      .toEqual({ ok: true, referenceVideoUrls: [ref(1), clip(1), clip(2)] })
    expect(seatCharacterVideos({ provider: "kling-4", referenceVideoUrls: undefined, characterReferences: [character(` ${clip(1)} `)] }))
      .toEqual({ ok: true, referenceVideoUrls: [clip(1)] })
  })

  it("a clip already wired as a reference video keeps its seat (it is the subject only)", () => {
    expect(seatCharacterVideos({ provider: "kling-4", referenceVideoUrls: [clip(1), ref(1)], characterReferences: [character(clip(1))] }))
      .toEqual({ ok: true, referenceVideoUrls: [clip(1), ref(1)] })
  })

  it("refused on a model that takes none, naming the ones that do", () => {
    const out = seatCharacterVideos({ provider: "gemini-omni-video", referenceVideoUrls: [], characterReferences: [character(clip(1))] })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe("character_video_unsupported")
      expect(out.message).toContain("kling-4, kling-4-flash")
    }
  })

  it("refused past 3 characters made from a video", () => {
    const out = seatCharacterVideos({ provider: "kling-4", referenceVideoUrls: [], characterReferences: [1, 2, 3, 4].map((n) => character(clip(n))) })
    expect(out.ok === false && out.code).toBe("character_videos_over_limit")
  })

  it("refused when two characters carry the same clip", () => {
    const out = seatCharacterVideos({ provider: "kling-4", referenceVideoUrls: [], characterReferences: [character(clip(1)), character(clip(1))] })
    expect(out.ok === false && out.code).toBe("character_video_shared")
  })

  it("refused when reference videos and clips together pass the model's 5 videos", () => {
    const four = [1, 2, 3, 4].map(ref)
    expect(seatCharacterVideos({ provider: "kling-4-flash", referenceVideoUrls: four, characterReferences: [character(clip(1))] }).ok).toBe(true)
    const out = seatCharacterVideos({ provider: "kling-4-flash", referenceVideoUrls: four, characterReferences: [character(clip(1)), character(clip(2))] })
    expect(out.ok === false && out.code).toBe("reference_videos_over_limit")
    if (!out.ok) expect(out.message).toContain("This run has 6")
  })

  // Decided 2026-11-13: on a model whose reference videos and video subjects
  // share one cap, plain reference videos past it are refused, never left out.
  it("plain reference videos alone past 5 are refused on Kling 4.0 and Flash; another model's list is not judged", () => {
    const six = [1, 2, 3, 4, 5, 6].map(ref)
    for (const provider of ["kling-4", "kling-4-flash"]) {
      const out = seatCharacterVideos({ provider, referenceVideoUrls: six, characterReferences: undefined })
      expect(out.ok === false && out.code, provider).toBe("reference_videos_over_limit")
      if (!out.ok) {
        expect(out.message).toContain("This run has 6")
        expect(out.message).not.toContain("from a character")
      }
      expect(seatCharacterVideos({ provider, referenceVideoUrls: six.slice(0, 5), characterReferences: [] }).ok).toBe(true)
    }
    expect(seatCharacterVideos({ provider: "seedance-2-5", referenceVideoUrls: six, characterReferences: undefined })).toEqual({ ok: true, referenceVideoUrls: six })
  })

  it("characterVideoUrls reads only non-empty string clips", () => {
    expect(characterVideoUrls([character(clip(1)), character(), { videoUrl: "  " }, { videoUrl: 7 }, null])).toEqual([clip(1)])
  })
})

describe("checkCharacterClipDurations — 3-8 s, measured", () => {
  it("in bounds passes; outside is refused with the clip's length", () => {
    expect(checkCharacterClipDurations("kling-4", [3, 8, 5.5])).toEqual({ ok: true })
    const short = checkCharacterClipDurations("kling-4-flash", [2.4])
    expect(short.ok === false && short.code).toBe("video_too_long")
    if (!short.ok) expect(short.message).toContain("one is 2.40 s")
    expect(checkCharacterClipDurations("kling-4", [8.6]).ok).toBe(false)
    // The measured length, rounded up to hundredths: 8.03 s never reads as 8.0.
    const justOver = checkCharacterClipDurations("kling-4", [8.0281])
    expect(justOver.ok === false && justOver.message).toContain("one is 8.03 s")
    const tiny = checkCharacterClipDurations("kling-4", [8.001])
    expect(tiny.ok === false && tiny.message).toContain("one is 8.01 s")
    expect(checkCharacterClipDurations("seedance-2", [30])).toEqual({ ok: true })
  })

  // Decided 2026-11-13: a character's clip must be measured to be accepted.
  it("a clip the probe could not read (NaN, 0) is refused, unlike a reference video", () => {
    for (const d of [Number.NaN, 0]) {
      const out = checkCharacterClipDurations("kling-4", [5, d])
      expect(out.ok === false && out.code).toBe("character_video_unreadable")
    }
  })
})

describe("a wired Character node's clip reaches its character reference", () => {
  const characterNode = (id: string, data: Record<string, unknown>) => ({ id, type: "character", data: { label: CHARACTER_NODE_DEFAULT_LABEL, characterName: "", ...data } })
  const wire = (source: string) => ({ source, target: "gv", sourceHandle: "characterRef" })

  it("wiredCharacterVideoUrls: by the slug the node goes by; the first clip of a merged name wins; a plain image wire gives none", () => {
    const nodes = [
      characterNode("a", { characterName: "Maya", subjectVideoUrl: clip(1) }),
      characterNode("b", { characterName: "Maya", subjectVideoUrl: clip(2) }),
      characterNode("u", { subjectVideoUrl: ` ${clip(3)} ` }),
      characterNode("i", { characterName: "Leo", subjectVideoUrl: clip(4) }),
      characterNode("n", { characterName: "Noa" }),
    ]
    const edges = [wire("a"), wire("b"), wire("u"), { source: "i", target: "gv", sourceHandle: "image" }, wire("n")]
    expect([...wiredCharacterVideoUrls("gv", nodes, edges)]).toEqual([["maya", clip(1)], ["character-1", clip(3)]])
  })

  it("characterReferencesFromWired carries the clip of the character it names", () => {
    const entry = (slug: string, name: string): ConnectedReference => ({
      id: `char_${slug}`, defaultName: name, source: "wired-character", url: `https://cdn.example/${slug}.png`, characterSlug: slug,
    })
    const refs = characterReferencesFromWired([entry("maya", "Maya"), entry("leo", "Leo")], new Map([["maya", clip(1)]]))
    expect(refs.map((r) => [r.name, r.videoUrl])).toEqual([["Maya", clip(1)], ["Leo", undefined]])
    expect("videoUrl" in refs[1]!).toBe(false)
    // Without the map (a model that takes no video subjects): no clip at all.
    expect(characterReferencesFromWired([entry("maya", "Maya")]).every((r) => !("videoUrl" in r))).toBe(true)
  })
})
