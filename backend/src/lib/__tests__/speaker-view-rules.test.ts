/**
 * Speaker View's option functions, normalizer, context and wire settings
 * (SV2, SV3, SV4, SV10, SV20, SV23 — C3.2). The rule's refusals are pinned to
 * the plugin by `speaker-view-parity.test.ts`; these pin the app-only part:
 * what the panel greys, what the strip lists, what the normalizer snaps.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  defaultSpeakerRegions,
  normalizeSpeakerViewData,
  speakerViewContext,
  speakerViewDefaultsFor,
  speakerViewRenderBasis,
  speakerViewWireSettings,
  validSpeakerEmphasis,
  validSpeakerLayouts,
  validSpeakerSwitches,
} from "@nodaro/render-rules"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" as const })
const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio" as const, role: "master-audio" }
const seg = (id: string, inS: number, video: string, speaker?: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}) })
const edl = (sources: unknown[], segments: unknown[], meta?: unknown) => ({ version: 1, clock: "master", sources, segments, ...(meta ? { meta } : {}) })

const TWO_CAM_TWO = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest"), seg("s2", 10, "a", "Host")])
const THREE = edl([MIC, src("a"), src("b"), src("c")], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")], { targetAspect: "16:9" })
const ONE_CAM_TWO = edl([MIC, src("w")], [seg("s0", 0, "w", "Host"), seg("s1", 5, "w", "Guest")])

const by = (opts: ReturnType<typeof validSpeakerLayouts>) => Object.fromEntries(opts.map((o) => [o.id, o]))

describe("pricing stays refused until C4", () => {
  it("says so in the plugin's own words", () => {
    expect(SPEAKER_VIEW_PRICED).toBe(false)
    expect(SPEAKER_VIEW_NOT_PRICED_MESSAGE).toBe("Speaker View is not priced yet")
  })
})

describe("validSpeakerLayouts (SV2, SV3)", () => {
  it("with no edit wired, judges the aspect alone: auto, single and grid always; side by side not at 9:16", () => {
    const l = by(validSpeakerLayouts({ targetAspect: "9:16" }))
    expect(l.auto!.allowed && l.single!.allowed && l.grid!.allowed && l.pip!.allowed && l.stacked!.allowed).toBe(true)
    expect(l["side-by-side"]).toMatchObject({ allowed: false, reason: { code: "aspect-not-drawn", params: { aspect: "9:16" } } })
    expect(by(validSpeakerLayouts({ targetAspect: "16:9" })).stacked).toMatchObject({ allowed: false, reason: { code: "aspect-not-drawn" } })
  })

  it("falls back to 16:9 when neither the node nor the edit names an aspect", () => {
    expect(by(validSpeakerLayouts({}))["side-by-side"]!.allowed).toBe(true)
    expect(by(validSpeakerLayouts({}))["stacked"]!.allowed).toBe(false)
  })

  it("greys what a 3-speaker edit cannot fill: side by side and pip take exactly 2, grid takes 2-6", () => {
    const ctx = speakerViewContext(THREE)!
    const l = by(validSpeakerLayouts({}, ctx))
    expect(l["side-by-side"]).toMatchObject({ allowed: false, reason: { code: "too-many-speakers", params: { max: 2, count: 3 } } })
    expect(l.pip).toMatchObject({ allowed: false, reason: { code: "too-many-speakers" } })
    expect(l.grid!.allowed).toBe(true)
    expect(l.single!.allowed && l.auto!.allowed).toBe(true)
  })

  it("greys every multi-slot layout for a one-speaker edit", () => {
    const ctx = speakerViewContext(edl([MIC, src("a")], [seg("s0", 0, "a", "Solo")]))!
    const l = by(validSpeakerLayouts({}, ctx))
    expect(l.grid).toMatchObject({ allowed: false, reason: { code: "too-few-speakers", params: { min: 2, count: 1 } } })
    expect(l["side-by-side"]!.allowed).toBe(false)
  })

  it("offers a layout only if it suits EVERY clip of a pack, and names the clip (SV23)", () => {
    const ctx = speakerViewContext([TWO_CAM_TWO, THREE, TWO_CAM_TWO])!
    expect(ctx.clips.map((c) => c.speakerCount)).toEqual([2, 3, 2])
    const l = by(validSpeakerLayouts({}, ctx))
    expect(l["side-by-side"]).toMatchObject({ allowed: false, reason: { code: "too-many-speakers", params: { clip: 2, count: 3 } } })
    expect(l.grid!.allowed).toBe(true)
  })

  it("takes the speaker count from the transcript labels when the edit names none", () => {
    const unnamed = edl([MIC, src("a")], [seg("s0", 0, "a")])
    const transcript = { words: [{ text: "a", startMs: 0, endMs: 1, speaker: "s0" }, { text: "b", startMs: 2, endMs: 3, speaker: "s1" }] }
    expect(speakerViewContext(unnamed, transcript)!.clips[0]!.speakers).toEqual(["s0", "s1"])
    expect(speakerViewContext(unnamed)!.clips[0]!.speakerCount).toBe(0)
  })
})

describe("validSpeakerSwitches (SV2, SV5)", () => {
  const ids = (o: ReturnType<typeof validSpeakerSwitches>) => o.filter((x) => x.allowed).map((x) => x.id)

  it("offers cut, pan and zoom under Single and Auto", () => {
    expect(ids(validSpeakerSwitches({ layout: "single" }))).toEqual(["cut", "pan", "zoom"])
    expect(ids(validSpeakerSwitches({}))).toEqual(["cut", "pan", "zoom"])
  })

  it("rules out pan and zoom under a fixed multi-slot layout: its slots stay put", () => {
    const o = validSpeakerSwitches({ layout: "grid" })
    expect(ids(o)).toEqual(["cut"])
    expect(o.find((x) => x.id === "pan")!.reason).toMatchObject({ code: "slots-fixed", params: { layout: "grid" } })
  })

  it("rules pan out only when NO speaker change stays inside one camera", () => {
    // Host on a, Guest on b: every change crosses cameras.
    expect(ids(validSpeakerSwitches({}, speakerViewContext(TWO_CAM_TWO)!))).toEqual(["cut", "zoom"])
    expect(validSpeakerSwitches({}, speakerViewContext(TWO_CAM_TWO)!).find((x) => x.id === "pan")!.reason).toMatchObject({ code: "no-same-camera-change", params: { changes: 2 } })
    // One wide camera: every change is inside it.
    expect(ids(validSpeakerSwitches({}, speakerViewContext(ONE_CAM_TWO)!))).toEqual(["cut", "pan", "zoom"])
  })

  it("keeps pan available when the changes cannot be counted yet (no speaker named on the edit)", () => {
    expect(ids(validSpeakerSwitches({}, speakerViewContext(edl([MIC, src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b")]))!))).toContain("pan")
  })
})

describe("validSpeakerEmphasis (SV2)", () => {
  it("is all greyed under Single: it shows one speaker", () => {
    const o = validSpeakerEmphasis({ layout: "single" })
    expect(o.every((x) => !x.allowed && x.reason?.code === "single-shows-one")).toBe(true)
  })
  it("greys scale in PiP, where the swap is the emphasis", () => {
    const o = validSpeakerEmphasis({ layout: "pip" })
    expect(o.find((x) => x.id === "scale")).toMatchObject({ allowed: false, reason: { code: "swap-is-emphasis" } })
    expect(o.filter((x) => x.allowed).map((x) => x.id)).toEqual(["border", "dim"])
  })
  it("allows scale, border and dim under Grid and Auto", () => {
    for (const layout of ["grid", "side-by-side", "stacked", "auto"]) expect(validSpeakerEmphasis({ layout }).every((x) => x.allowed)).toBe(true)
  })
})

describe("normalizeSpeakerViewData (SV4 a — coerces, never rejects)", () => {
  it("snaps side by side to stacked at 9:16 and says so", () => {
    const r = normalizeSpeakerViewData({ layout: "side-by-side", targetAspect: "9:16" })
    expect(r.data.layout).toBe("stacked")
    expect(r.notes).toEqual([{ code: "layout-snapped", from: "side-by-side", to: "stacked", aspect: "9:16", because: "aspect" }])
    expect(normalizeSpeakerViewData({ layout: "stacked", targetAspect: "16:9" }).data.layout).toBe("side-by-side")
  })

  it("leaves a layout alone when neither the node nor an edit names an aspect (pitfall 5b: do not judge an aspect you do not know)", () => {
    // A write boundary with no edit in hand cannot tell a 9:16 edit from a 16:9 one.
    const r = normalizeSpeakerViewData({ layout: "stacked" })
    expect(r.data.layout).toBe("stacked")
    expect(r.notes).toEqual([])
    expect(normalizeSpeakerViewData({ layout: "side-by-side" }).data.layout).toBe("side-by-side")
    // A malformed aspect is dropped, which leaves the node with none: still unjudged.
    expect(normalizeSpeakerViewData({ layout: "stacked", targetAspect: "2:1" as never }).data.layout).toBe("stacked")
    // The node's own aspect is a fact, so it still snaps.
    expect(normalizeSpeakerViewData({ layout: "stacked", targetAspect: "16:9" }).data.layout).toBe("side-by-side")
  })

  it("snaps to grid when the count fits and to single when it does not, using the real EDL", () => {
    expect(normalizeSpeakerViewData({ layout: "side-by-side" }, speakerViewContext(THREE)!).data.layout).toBe("grid")
    expect(normalizeSpeakerViewData({ layout: "side-by-side" }, speakerViewContext(THREE)!).notes[0]).toMatchObject({ because: "speakers" })
    expect(normalizeSpeakerViewData({ layout: "pip" }, speakerViewContext(THREE)!).data.layout).toBe("grid")
    expect(normalizeSpeakerViewData({ layout: "grid" }, speakerViewContext(edl([MIC, src("a")], [seg("s0", 0, "a", "Solo")]))!).data.layout).toBe("single")
  })

  it("takes the aspect from the edit when the node names none", () => {
    expect(normalizeSpeakerViewData({ layout: "stacked" }, speakerViewContext(THREE)!).data.layout).toBe("grid")
    expect(normalizeSpeakerViewData({ layout: "side-by-side" }, speakerViewContext(edl([MIC, src("a"), src("b")], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G")], { targetAspect: "9:16" }))!).data.layout).toBe("stacked")
  })

  it("keeps a layout that already fits, and never touches single or auto", () => {
    for (const layout of ["auto", "single", "grid", "pip"]) expect(normalizeSpeakerViewData({ layout, targetAspect: "16:9" }, speakerViewContext(TWO_CAM_TWO)!).data.layout).toBe(layout)
    expect(normalizeSpeakerViewData({ layout: "side-by-side", targetAspect: "16:9" }, speakerViewContext(TWO_CAM_TWO)!).notes).toEqual([])
  })

  it("replaces an unknown id with a default instead of rejecting", () => {
    const r = normalizeSpeakerViewData({ layout: "carousel", switchType: "swirl", emphasisStyle: "glow", accentColor: "red", targetAspect: "21:9", switchDurationMs: "slow", emphasisDurationMs: 99_999 })
    expect(r.data).toEqual({ layout: "auto", switchType: "cut", emphasisStyle: "none", emphasisDurationMs: 5000 })
  })

  it("keeps a switch or emphasis the matrix rules out: a later change of layout brings it back", () => {
    const r = normalizeSpeakerViewData({ layout: "grid", switchType: "pan", emphasisStyle: "scale" })
    expect(r.data).toMatchObject({ layout: "grid", switchType: "pan", emphasisStyle: "scale" })
  })

  it("does not mutate its input", () => {
    const input = Object.freeze({ layout: "side-by-side", targetAspect: "9:16" })
    expect(() => normalizeSpeakerViewData(input)).not.toThrow()
    expect(input.layout).toBe("side-by-side")
  })
})

describe("speakerViewDefaultsFor (SV20)", () => {
  it("one video source: Single + Pan 600 ms; emphasis Scale 300 ms; the edit's aspect", () => {
    expect(speakerViewDefaultsFor(speakerViewContext(ONE_CAM_TWO)!)).toEqual({ layout: "single", switchType: "pan", switchDurationMs: 600, emphasisStyle: "scale", emphasisDurationMs: 300, targetAspect: "16:9" })
  })
  it("two or more: Auto + Cut", () => {
    const d = speakerViewDefaultsFor(speakerViewContext({ ...THREE, meta: { targetAspect: "9:16" } })!)
    expect(d).toMatchObject({ layout: "auto", switchType: "cut", targetAspect: "9:16" })
  })
})

describe("speakerViewContext", () => {
  it("is undefined until an edit is known, and skips what is not an edit", () => {
    expect(speakerViewContext(undefined)).toBeUndefined()
    expect(speakerViewContext("not json")).toBeUndefined()
    expect(speakerViewContext([null, {}, "x"])).toBeUndefined()
    expect(speakerViewContext([null, TWO_CAM_TWO])!.clips).toHaveLength(1)
  })
  it("reads a clips-mode batch of JSON strings", () => {
    expect(speakerViewContext([JSON.stringify(TWO_CAM_TWO), JSON.stringify(THREE)])!.clips.map((c) => c.cameras)).toEqual([2, 3])
  })
})

describe("speakerViewWireSettings (one body for both engines)", () => {
  it("renames the flat node fields to the route's nested switch and emphasis, normalized", () => {
    expect(speakerViewWireSettings({ targetAspect: "9:16", layout: "side-by-side", switchType: "pan", switchDurationMs: 600, emphasisStyle: "scale+border", emphasisDurationMs: 300, accentColor: "#FFAA00" })).toEqual({
      targetAspect: "9:16", layout: "stacked", switch: { type: "pan", durationMs: 600 }, emphasis: { style: "scale+border", durationMs: 300 }, accentColor: "#FFAA00",
    })
  })
  it("sends nothing for a node that sets nothing", () => {
    expect(speakerViewWireSettings({})).toEqual({})
  })
  it("sends only the framing rows the route accepts", () => {
    const row = (source: string, speaker: string, region: unknown) => ({ source, speaker, region })
    const w = speakerViewWireSettings({ speakerRegions: [row("a", "H", { x: 0, y: 0, w: 0.5, h: 1 }), row("a", "G", { x: 0, y: 0, w: 0.5, h: 0.001 }), row("", "G", { x: 0, y: 0, w: 1, h: 1 }), row("a", "X", { x: 0.7, y: 0, w: 0.6, h: 1 })] })
    expect(w.speakerRegions).toEqual([{ source: "a", speaker: "H", region: { x: 0, y: 0, w: 0.5, h: 1 } }])
  })
})

describe("speakerViewRenderBasis (the stamp, decided 2026-10-07)", () => {
  const sources = [{ url: "https://x/a.mp4" }, { url: "https://x/b.mp4" }]
  it("is 16 hex digits and stable", () => {
    const b = speakerViewRenderBasis({ layout: "grid" }, { sources } as never)
    expect(b).toMatch(/^[0-9a-f]{16}$/)
    expect(speakerViewRenderBasis({ layout: "grid" }, { sources } as never)).toBe(b)
  })
  it("changes with any picture-changing setting and with a source's url", () => {
    const base = speakerViewRenderBasis({ layout: "grid" }, { sources } as never)
    expect(speakerViewRenderBasis({ layout: "pip" }, { sources } as never)).not.toBe(base)
    expect(speakerViewRenderBasis({ layout: "grid", accentColor: "#FFFFFF" }, { sources } as never)).not.toBe(base)
    expect(speakerViewRenderBasis({ layout: "grid" }, { sources: [sources[0]!, { url: "https://x/c.mp4" }] } as never)).not.toBe(base)
  })
})

describe("defaultSpeakerRegions (the overview's left and right thirds)", () => {
  it("two speakers on a 16:9 camera at a 9:16 slot: full height, 9/16 / 16/9 wide, centred at 1/4 and 3/4", () => {
    const r = defaultSpeakerRegions(["Host", "Guest"], 9 / 16, 16 / 9)
    expect(r.map((x) => x.speaker)).toEqual(["Host", "Guest"])
    for (const { region } of r) {
      expect(region.y).toBe(0)
      expect(region.h).toBe(1)
      expect(region.w).toBeCloseTo(0.3164, 3)
    }
    expect(r[0]!.region.x + r[0]!.region.w / 2).toBeCloseTo(0.25, 3)
    expect(r[1]!.region.x + r[1]!.region.w / 2).toBeCloseTo(0.75, 3)
  })
  it("gives a lone speaker no box (full frame) and keeps every box inside the frame", () => {
    expect(defaultSpeakerRegions(["Solo"], 9 / 16, 16 / 9)).toEqual([])
    for (const { region } of defaultSpeakerRegions(["a", "b", "c", "d", "e", "f"], 1, 4 / 3)) expect(region.x + region.w).toBeLessThanOrEqual(1 + 1e-9)
  })
})
