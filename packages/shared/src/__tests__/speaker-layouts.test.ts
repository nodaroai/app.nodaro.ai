import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { COMBINE_TRANSITIONS } from "../combine-transitions.js"
import { edlDurationMs, type Edl } from "../edl.js"
import {
  EDL_TARGET_ASPECTS,
  SPEAKER_LAYOUTS,
  SPEAKER_LAYOUT_IDS,
  getSpeakerLayout,
  speakerLayoutAllows,
  speakerSwitchOverlaps,
  SPEAKER_SWITCHES,
  SPEAKER_SWITCH_IDS,
  getSpeakerSwitch,
  SPEAKER_EMPHASIS_STYLES,
  parseSpeakerEmphasisStyle,
  isKnownSpeakerEmphasisStyle,
  isEdlTargetAspect,
  speakerPresentationWarnings,
} from "../speaker-layouts.js"

describe("SPEAKER_LAYOUTS registry", () => {
  it("has unique ids, and SPEAKER_LAYOUT_IDS is derived from it", () => {
    expect(new Set(SPEAKER_LAYOUT_IDS).size).toBe(SPEAKER_LAYOUT_IDS.length)
    expect(SPEAKER_LAYOUT_IDS).toEqual(SPEAKER_LAYOUTS.map((l) => l.id))
  })

  it("every sheet has 1 ≤ minSlots ≤ maxSlots", () => {
    for (const l of SPEAKER_LAYOUTS) {
      expect(l.minSlots, l.id).toBeGreaterThanOrEqual(1)
      expect(l.minSlots, l.id).toBeLessThanOrEqual(l.maxSlots)
    }
  })

  it("every sheet's aspects are non-empty, unique, and ⊆ EDL_TARGET_ASPECTS", () => {
    for (const l of SPEAKER_LAYOUTS) {
      expect(l.aspects.length, l.id).toBeGreaterThan(0)
      expect(new Set(l.aspects).size, l.id).toBe(l.aspects.length)
      for (const a of l.aspects) expect(EDL_TARGET_ASPECTS as readonly string[], l.id).toContain(a)
    }
  })

  it("pins the v1 layout set and the NARROW honest aspect list (aspects a renderer is drawn for; widen additively only)", () => {
    const pinned = Object.fromEntries(
      SPEAKER_LAYOUTS.map((l) => [l.id, { minSlots: l.minSlots, maxSlots: l.maxSlots, aspects: [...l.aspects] }]),
    )
    const all = ["16:9", "9:16", "1:1", "4:5"]
    expect(pinned).toEqual({
      single: { minSlots: 1, maxSlots: 1, aspects: all },
      "side-by-side": { minSlots: 2, maxSlots: 2, aspects: ["16:9", "1:1"] },
      stacked: { minSlots: 2, maxSlots: 2, aspects: ["9:16", "4:5", "1:1"] },
      grid: { minSlots: 2, maxSlots: 6, aspects: all },
      pip: { minSlots: 2, maxSlots: 2, aspects: all },
    })
    expect([...EDL_TARGET_ASPECTS]).toEqual(all)
  })

  it("getSpeakerLayout looks up by id and returns undefined for an unknown id", () => {
    expect(getSpeakerLayout("grid")?.maxSlots).toBe(6)
    expect(getSpeakerLayout("carousel")).toBeUndefined()
  })
})

describe("speakerLayoutAllows", () => {
  const sbs = getSpeakerLayout("side-by-side")!
  const grid = getSpeakerLayout("grid")!

  it("checks the aspect against the sheet's drawn aspects", () => {
    expect(speakerLayoutAllows(sbs, { aspect: "16:9" })).toBe(true)
    expect(speakerLayoutAllows(sbs, { aspect: "9:16" })).toBe(false)
  })

  it("checks the slot count against the inclusive [minSlots, maxSlots] range", () => {
    expect(speakerLayoutAllows(grid, { slotCount: 2 })).toBe(true)
    expect(speakerLayoutAllows(grid, { slotCount: 6 })).toBe(true)
    expect(speakerLayoutAllows(grid, { slotCount: 1 })).toBe(false)
    expect(speakerLayoutAllows(grid, { slotCount: 7 })).toBe(false)
  })

  it("treats omitted query fields as unconstrained, and needs BOTH to pass when both are given", () => {
    expect(speakerLayoutAllows(sbs, {})).toBe(true)
    expect(speakerLayoutAllows(sbs, { aspect: "1:1", slotCount: 2 })).toBe(true)
    expect(speakerLayoutAllows(sbs, { aspect: "1:1", slotCount: 3 })).toBe(false)
    expect(speakerLayoutAllows(sbs, { aspect: "4:5", slotCount: 2 })).toBe(false)
  })
})

describe("SPEAKER_SWITCHES registry", () => {
  const xfadeFamily = COMBINE_TRANSITIONS.filter((t) => t.xfade !== null)

  it("has unique ids, and SPEAKER_SWITCH_IDS is derived from it", () => {
    expect(new Set(SPEAKER_SWITCH_IDS).size).toBe(SPEAKER_SWITCH_IDS.length)
    expect(SPEAKER_SWITCH_IDS).toEqual(SPEAKER_SWITCHES.map((s) => s.id))
  })

  it("totality: every combine transition with an xfade appears as xfade:<id>, xfade:cut never does, count = cut/pan/zoom + that family", () => {
    for (const t of xfadeFamily) expect(SPEAKER_SWITCH_IDS).toContain(`xfade:${t.id}`)
    expect(SPEAKER_SWITCH_IDS).not.toContain("xfade:cut")
    expect(getSpeakerSwitch("xfade:cut")).toBeUndefined()
    expect(SPEAKER_SWITCH_IDS.slice(0, 3)).toEqual(["cut", "pan", "zoom"])
    expect(SPEAKER_SWITCHES.length).toBe(3 + xfadeFamily.length)
  })

  it("the source file hand-lists no xfade:<id> literal (the family is DERIVED) and states the prefix exactly once", () => {
    const text = readFileSync(new URL("../speaker-layouts.ts", import.meta.url), "utf8")
    // A quoted/templated string that starts with the prefix and continues with an
    // id character is a hand-listed switch id.
    expect(text.match(/["'`]xfade:[a-z0-9]/gi)).toBeNull()
    // The overlap rule's prefix is the ONE bare literal.
    expect(text.match(/"xfade:"/g)).toHaveLength(1)
  })

  it("every sheet's overlaps === speakerSwitchOverlaps(id): the xfade family overlaps, cut/pan/zoom do not", () => {
    for (const s of SPEAKER_SWITCHES) expect(s.overlaps, s.id).toBe(speakerSwitchOverlaps(s.id))
    for (const id of ["cut", "pan", "zoom"]) expect(getSpeakerSwitch(id)?.overlaps, id).toBe(false)
    for (const t of xfadeFamily) expect(getSpeakerSwitch(`xfade:${t.id}`)?.overlaps, t.id).toBe(true)
  })

  it("requiresSameSource is true only for pan", () => {
    expect(SPEAKER_SWITCHES.filter((s) => s.requiresSameSource).map((s) => s.id)).toEqual(["pan"])
  })

  it("an UNKNOWN xfade:bogus still overlaps under the D17 rule (edlDurationMs subtracts it) though getSpeakerSwitch returns undefined — an executor refuses it, the clock never guesses", () => {
    expect(getSpeakerSwitch("xfade:bogus")).toBeUndefined()
    expect(speakerSwitchOverlaps("xfade:bogus")).toBe(true)
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "a", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 4000, video: "a" },
        { id: "s1", inMs: 4000, outMs: 8000, video: "a", layout: { mode: "single", transition: { type: "xfade:bogus", durationMs: 500 } } },
      ],
    }
    expect(edlDurationMs(edl)).toBe(7500)
  })

  it("getSpeakerSwitch is a plain lookup that never throws on an unknown id", () => {
    expect(getSpeakerSwitch("pan")?.requiresSameSource).toBe(true)
    expect(() => getSpeakerSwitch("wipe")).not.toThrow()
    expect(getSpeakerSwitch("wipe")).toBeUndefined()
  })
})

describe("emphasis styles", () => {
  it("are atomic ids (no '+' inside an id)", () => {
    expect([...SPEAKER_EMPHASIS_STYLES]).toEqual(["none", "scale", "border", "dim"])
    for (const s of SPEAKER_EMPHASIS_STYLES) expect(s).not.toContain("+")
  })

  it("parseSpeakerEmphasisStyle splits on '+', trims, drops empties", () => {
    expect(parseSpeakerEmphasisStyle("scale+border")).toEqual(["scale", "border"])
    expect(parseSpeakerEmphasisStyle(" scale + dim ")).toEqual(["scale", "dim"])
    expect(parseSpeakerEmphasisStyle("scale++border+")).toEqual(["scale", "border"])
    expect(parseSpeakerEmphasisStyle("")).toEqual([])
  })

  it("isKnownSpeakerEmphasisStyle needs ≥1 atom and every atom known", () => {
    expect(isKnownSpeakerEmphasisStyle("scale+border")).toBe(true)
    expect(isKnownSpeakerEmphasisStyle(" scale + dim ")).toBe(true)
    expect(isKnownSpeakerEmphasisStyle("none")).toBe(true)
    expect(isKnownSpeakerEmphasisStyle("scale+glow")).toBe(false)
    expect(isKnownSpeakerEmphasisStyle("")).toBe(false)
    expect(isKnownSpeakerEmphasisStyle(" + ")).toBe(false)
  })

  it("isEdlTargetAspect narrows an open targetAspect to a known aspect", () => {
    expect(isEdlTargetAspect("9:16")).toBe(true)
    expect(isEdlTargetAspect("21:9")).toBe(false)
    expect(isEdlTargetAspect(null)).toBe(false)
  })

  it("isKnownSpeakerEmphasisStyle: `none` stands alone and no atom repeats", () => {
    expect(isKnownSpeakerEmphasisStyle("none+scale")).toBe(false)
    expect(isKnownSpeakerEmphasisStyle("scale+scale")).toBe(false)
    expect(isKnownSpeakerEmphasisStyle("scale+border+dim")).toBe(true)
  })
})

describe("speakerPresentationWarnings — pure, never throws", () => {
  it("returns [] for an EDL with no layouts and no target aspect", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "a", url: "u", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "a" }],
    }
    expect(speakerPresentationWarnings(edl)).toEqual([])
  })

  it("guards a raw object that skipped normalizeEdl (non-array sources/segments, garbage layout fields)", () => {
    const garbage = [
      {},
      { segments: "nope", sources: 7 },
      { segments: [null, { id: "s1", layout: { mode: 3, transition: { type: 9 }, emphasis: { style: null } } }], sources: null },
      { meta: "x", segments: [{ id: "s0", layout: { mode: "pan", slots: "x" } }] },
    ]
    for (const g of garbage) {
      expect(() => speakerPresentationWarnings(g as unknown as Edl)).not.toThrow()
    }
    expect(speakerPresentationWarnings(null as unknown as Edl)).toEqual([])
  })
})
