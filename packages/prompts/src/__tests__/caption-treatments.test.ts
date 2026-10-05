// packages/prompts/src/__tests__/caption-treatments.test.ts
import { describe, it, expect } from "vitest"
import { captionRoutesToRemotion, type CaptionPlan } from "@nodaro/shared"
import {
  BODY_CAPTIONS_PRESET_ID,
  CAPTION_LEVERS_BY_LANGUAGE,
  CAPTION_SEGMENT_LEVER_KEYS,
  HOOK_PLATE_PRESET_ID,
  hookPlateCaptionSegments,
} from "../caption-treatments.js"
import { getFactoryPresets } from "../factory-presets.js"

type CaptionInput = Parameters<typeof captionRoutesToRemotion>[0]
const data = (id: string) => getFactoryPresets("add-captions").find((p) => p.id === id)!.data
const levers = (d: Readonly<Record<string, unknown>>) => Object.fromEntries(Object.entries(d).filter(([k]) => CAPTION_SEGMENT_LEVER_KEYS.includes(k)))
const PLATE = levers(data(HOOK_PLATE_PRESET_ID))
const BODY = levers(data(BODY_CAPTIONS_PRESET_ID))
const KARAOKE = data("add-captions/karaoke")
const WORDS = [
  { text: "so", startMs: 1600, endMs: 1900 },
  { text: "I", startMs: 2000, endMs: 2200 },
  { text: "opened", startMs: 2200, endMs: 2600 },
  { text: "Acme", startMs: 2600, endMs: 4000 },
]
const PLAN: CaptionPlan = { v: 1, hookText: " Saved 3 hours a week ", hookEndMs: 1600, bodyEndMs: 4300, captions: WORDS }
const SEGMENT_SHAPE_KEYS = new Set([...CAPTION_SEGMENT_LEVER_KEYS, "startMs", "endMs", "text", "captions"])

describe("hookPlateCaptionSegments — windows and sources", () => {
  it("emits the plate, then the body, with the opening line untrimmed and the words as captions", () => {
    const r = hookPlateCaptionSegments(PLAN)
    expect(r.dropped).toEqual([])
    expect(r.segments).toEqual([
      { startMs: 0, endMs: 1600, text: " Saved 3 hours a week ", ...PLATE },
      { startMs: 1600, endMs: 4300, captions: WORDS, ...BODY },
    ])
  })

  it("the plate's levers are Hook Plate's segment levers (autoTranscribe is not a segment key)", () => {
    expect(PLATE).not.toHaveProperty("autoTranscribe")
    expect(hookPlateCaptionSegments(PLAN).segments[0]).not.toHaveProperty("autoTranscribe")
  })

  it("every emitted key is a segment lever, a time, the text or the captions", () => {
    for (const s of hookPlateCaptionSegments({ ...PLAN, language: "he" }, { bodyLevers: KARAOKE }).segments)
      for (const k of Object.keys(s)) expect(SEGMENT_SHAPE_KEYS.has(k), k).toBe(true)
  })
})

describe("hookPlateCaptionSegments — drop cases (never throws)", () => {
  it("a blank opening line → body only, still starting where the opening line ends", () => {
    const r = hookPlateCaptionSegments({ ...PLAN, hookText: "   " })
    expect(r.dropped).toEqual(["hook"])
    expect(r.segments).toHaveLength(1)
    expect(r.segments[0]).toMatchObject({ startMs: 1600, endMs: 4300 })
  })
  it("no body words → plate only", () => {
    const r = hookPlateCaptionSegments({ ...PLAN, captions: [] })
    expect(r.dropped).toEqual(["body"])
    expect(r.segments.map((s) => s.text)).toEqual([" Saved 3 hours a week "])
  })
  it("a video that ends before the opening line → the plate ends with the video, the body is dropped", () => {
    const r = hookPlateCaptionSegments({ ...PLAN, videoDurationMs: 1000 })
    expect(r.segments).toEqual([{ startMs: 0, endMs: 1000, text: " Saved 3 hours a week ", ...PLATE }])
    expect(r.dropped).toEqual(["body"])
  })
  it("a video length of 0 → both dropped", () => {
    expect(hookPlateCaptionSegments({ ...PLAN, videoDurationMs: 0 })).toEqual({ segments: [], dropped: ["hook", "body"] })
  })
  it("a video that ends exactly where the opening line ends → plate only", () => {
    const r = hookPlateCaptionSegments({ ...PLAN, videoDurationMs: 1600 })
    expect(r.segments).toHaveLength(1)
    expect(r.dropped).toEqual(["body"])
  })
  it("a body that ends at or before the opening line's end → body dropped", () => {
    for (const bodyEndMs of [1600, 1000]) expect(hookPlateCaptionSegments({ ...PLAN, bodyEndMs }).dropped).toEqual(["body"])
  })
  it("a negative or non-finite hookEndMs → both dropped", () => {
    for (const hookEndMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1600" as unknown as number])
      expect(hookPlateCaptionSegments({ ...PLAN, hookEndMs })).toEqual({ segments: [], dropped: ["hook", "body"] })
  })
  it("the body never starts before the opening line ends, whatever the video length", () => {
    for (const videoDurationMs of [0, 500, 1599, 1600, 1601, 99_999])
      for (const s of hookPlateCaptionSegments({ ...PLAN, videoDurationMs }).segments) if (s.captions) expect(s.startMs).toBe(1600)
  })
  it("never throws on non-numeric times", () => {
    expect(() => hookPlateCaptionSegments({ ...PLAN, bodyEndMs: Number.NaN })).not.toThrow()
    expect(() => hookPlateCaptionSegments({ ...PLAN, videoDurationMs: Number.NaN })).not.toThrow()
    expect(hookPlateCaptionSegments({ ...PLAN, videoDurationMs: Number.NaN }).dropped).toEqual(["hook", "body"])
  })
})

describe("hookPlateCaptionSegments — language levers", () => {
  it("he → Rubik and uppercase false on both segments, winning over a bodyLevers fontFamily", () => {
    const r = hookPlateCaptionSegments({ ...PLAN, language: "he" }, { bodyLevers: { ...BODY, fontFamily: "Anton" } })
    expect(r.segments).toHaveLength(2)
    for (const s of r.segments) expect(s).toMatchObject({ fontFamily: "Rubik", uppercase: false })
  })
  it("a regional or capitalised Hebrew tag gets the Hebrew levers", () => {
    for (const language of ["he-IL", "HE", "he_IL"])
      for (const s of hookPlateCaptionSegments({ ...PLAN, language }).segments) expect(s, language).toMatchObject({ fontFamily: "Rubik", uppercase: false })
  })
  it("en, an unmapped tag, an inherited key name or no language → neither key", () => {
    for (const language of ["en", "fr", "constructor", undefined])
      for (const s of hookPlateCaptionSegments({ ...PLAN, language }).segments) {
        expect(s, String(language)).not.toHaveProperty("fontFamily")
        expect(s, String(language)).not.toHaveProperty("uppercase")
      }
  })
})

describe("hookPlateCaptionSegments — body levers", () => {
  it("bodyLevers restyle the body only", () => {
    const [plate, body] = hookPlateCaptionSegments(PLAN, { bodyLevers: KARAOKE }).segments
    expect(body).toMatchObject({ style: "karaoke", fontSize: 56, position: "bottom" })
    expect(plate).toEqual({ startMs: 0, endMs: 1600, text: " Saved 3 hours a week ", ...PLATE })
  })
  it("bodyLevers keep only segment levers, and drop null and undefined values", () => {
    const body = hookPlateCaptionSegments(PLAN, {
      bodyLevers: { ...KARAOKE, autoTranscribe: true, text: "x", label: "Captions", fontFamily: null, strokeColor: undefined },
    }).segments[1]!
    for (const k of ["autoTranscribe", "label", "fontFamily", "strokeColor"]) expect(body, k).not.toHaveProperty(k)
    expect(body.text).toBeUndefined()
    expect(body.style).toBe("karaoke")
  })
  it("no bodyLevers, or none left after filtering → Body Captions", () => {
    for (const opts of [undefined, {}, { bodyLevers: {} }, { bodyLevers: { autoTranscribe: true, label: "x" } }])
      expect(hookPlateCaptionSegments(PLAN, opts).segments[1]).toEqual({ startMs: 1600, endMs: 4300, captions: WORDS, ...BODY })
  })
})

describe("hookPlateCaptionSegments — the plate never falls back to drawtext", () => {
  it("every plate segment, sent alone, routes to the styled renderer — for every mapped language and for none", () => {
    for (const language of [undefined, ...Object.keys(CAPTION_LEVERS_BY_LANGUAGE)]) {
      const plate = hookPlateCaptionSegments({ ...PLAN, language }).segments[0]!
      expect(plate.text, String(language)).toBeDefined()
      expect(captionRoutesToRemotion(plate as CaptionInput), String(language)).toBe(true)
    }
  })
  it("bodyLevers never reach the plate", () => {
    const plate = hookPlateCaptionSegments(PLAN, { bodyLevers: { fontFamily: "Anton", backgroundColor: "#FF0000", positionY: 90, style: "karaoke" } }).segments[0]
    expect(plate).toEqual({ startMs: 0, endMs: 1600, text: " Saved 3 hours a week ", ...PLATE })
  })
})

describe("caption lever constants", () => {
  it("CAPTION_SEGMENT_LEVER_KEYS is the route's segment keys without times and words", () => {
    expect([...CAPTION_SEGMENT_LEVER_KEYS].sort()).toEqual(
      ["style", "position", "fontSize", "color", "backgroundColor", "look", "fontFamily", "fontWeight", "strokeColor", "strokeWidth", "highlightColor", "uppercase", "positionY", "animate", "maxWordsPerLine"].sort(),
    )
  })
  it("every language entry uses segment lever keys only", () => {
    for (const entry of Object.values(CAPTION_LEVERS_BY_LANGUAGE))
      for (const k of Object.keys(entry)) expect(CAPTION_SEGMENT_LEVER_KEYS.includes(k), k).toBe(true)
  })
})
