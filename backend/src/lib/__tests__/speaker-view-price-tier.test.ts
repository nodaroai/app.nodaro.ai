/**
 * Speaker View's price tier (C4, decided 2026-10-10): 1–2 tiles and no zoom is
 * `standard`; 3–6 tiles on any segment, or any zoom, is `complex`. Counted on
 * the edit as given, laid out by the plugin's layout stage (this repo's
 * mirror); the plugin's route prices with its own copy, held to these answers
 * by `speaker-view-pricing-cases.json` (`speaker-view-pricing-parity.test.ts`).
 */
import { describe, it, expect } from "vitest"
import {
  resolveSpeakerViewEstimateTier,
  speakerViewEstimateTier,
  speakerViewPriceBasis,
  speakerViewPriceTier,
  speakerViewSettingsTier,
  renderEstimateCreditId,
  TIER_PRICED_RENDER_TYPES,
} from "@nodaro/render-rules"
import { speakerViewContext, speakerViewWireSettings } from "@nodaro/render-rules"
import { EDL_TARGET_ASPECTS, RENDER_NODE_TYPE_IDS, SPEAKER_LAYOUT_IDS } from "@nodaro/shared"

const src = (id: string, offsetMs?: number) => ({ id, url: `https://x/${id}.mp4`, kind: "video" as const, ...(offsetMs !== undefined ? { offsetMs } : {}) })
const MIC = { id: "mic", url: "https://x/mic.wav", kind: "audio" as const, role: "master-audio" }
const seg = (id: string, inS: number, video: string, speaker?: string, extra: Record<string, unknown> = {}) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}), ...extra })
const edl = (sources: unknown[], segments: unknown[], meta?: unknown) => ({ version: 1, clock: "master", sources, segments, ...(meta ? { meta } : {}) })
const hint = (mode: string, ...slots: Array<[string, string]>) => ({ layout: { mode, slots: slots.map(([source, speaker]) => ({ source, speaker })) } })

const TWO = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest"), seg("s2", 10, "a", "Host")])
const THREE = edl([MIC, src("a"), src("b"), src("c")], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")])
const SIX = edl(
  [MIC, ...["a", "b", "c", "d", "e", "f"].map((id) => src(id))],
  ["a", "b", "c", "d", "e", "f"].map((id, i) => seg(`s${i}`, i * 5, id, `S${i}`)),
)
// Camera Switch's crosstalk hints: a two-up at s1, a three-up at s2.
const HINTED_2 = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a", "Host"), seg("s1", 5, "a", "Host", hint("side-by-side", ["a", "Host"], ["b", "Guest"])), seg("s2", 10, "b", "Guest")])
const HINTED_3 = edl([MIC, src("a"), src("b"), src("c")], [seg("s0", 0, "a", "H"), seg("s1", 5, "a", "H", hint("grid", ["a", "H"], ["b", "G"], ["c", "P"]))])

const tier = (e: unknown, settings: Record<string, unknown> = {}, transcript?: unknown) => speakerViewPriceTier({ edl: e, settings, ...(transcript !== undefined ? { transcript } : {}) })

describe("speakerViewPriceTier — tiles on the laid-out edit, and zoom", () => {
  it("single: one tile, standard", () => {
    expect(speakerViewPriceBasis({ edl: TWO, settings: { layout: "single" } })).toEqual({ tier: "standard", maxTiles: 1, zoom: false })
  })

  it("side by side and pip: two tiles, standard", () => {
    expect(speakerViewPriceBasis({ edl: TWO, settings: { layout: "side-by-side" } })).toMatchObject({ tier: "standard", maxTiles: 2 })
    expect(speakerViewPriceBasis({ edl: TWO, settings: { layout: "pip" } })).toMatchObject({ tier: "standard", maxTiles: 2 })
  })

  it("grid: complex from three speakers up, to six", () => {
    expect(speakerViewPriceBasis({ edl: THREE, settings: { layout: "grid" } })).toMatchObject({ tier: "complex", maxTiles: 3 })
    expect(speakerViewPriceBasis({ edl: SIX, settings: { layout: "grid" } })).toMatchObject({ tier: "complex", maxTiles: 6 })
  })

  it("a grid of two speakers draws side by side: standard", () => {
    expect(speakerViewPriceBasis({ edl: TWO, settings: { layout: "grid" } })).toMatchObject({ tier: "standard", maxTiles: 2 })
  })

  it("auto follows the edit's hints: a two-up is standard, any three-up makes the whole render complex", () => {
    expect(speakerViewPriceBasis({ edl: HINTED_2, settings: { layout: "auto" } })).toMatchObject({ tier: "standard", maxTiles: 2 })
    expect(speakerViewPriceBasis({ edl: HINTED_3, settings: {} })).toMatchObject({ tier: "complex", maxTiles: 3 })
    expect(tier(TWO)).toBe("standard")
  })

  it("single forces one tile over every hint", () => {
    expect(tier(HINTED_3, { layout: "single" })).toBe("standard")
  })

  it("a Zoom switch where one picture is re-framed (single, pip, auto's one-camera segments) is complex", () => {
    for (const layout of ["single", "pip", "auto"]) {
      expect(speakerViewPriceBasis({ edl: TWO, settings: { layout, switch: { type: "zoom", durationMs: 600 } } }), layout).toMatchObject({ tier: "complex", zoom: true })
    }
  })

  it("a Zoom switch under a fixed side by side or grid draws nothing: the tiles decide", () => {
    expect(tier(TWO, { layout: "side-by-side", switch: { type: "zoom" } })).toBe("standard")
    expect(tier(THREE, { layout: "grid", switch: { type: "zoom" } })).toBe("complex")
  })

  it("a segment's own zoom counts where it can be drawn", () => {
    const own = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a", "Host"), seg("s1", 5, "a", "Guest", { layout: { mode: "single", transition: { type: "zoom", durationMs: 400 } } })])
    expect(tier(own)).toBe("complex")
    expect(tier(own, { layout: "side-by-side" })).toBe("standard")
  })

  it("pan and cut never make a render complex", () => {
    expect(tier(TWO, { layout: "single", switch: { type: "pan" } })).toBe("standard")
    expect(tier(TWO, { layout: "single", switch: { type: "cut" } })).toBe("standard")
    expect(tier(TWO, { layout: "single", switch: { type: "xfade:wipe-left", durationMs: 400 } })).toBe("standard")
  })

  it("the late-camera snap counts per segment: the most tiles any segment draws decides", () => {
    // Camera c begins at 7 s: s0 and s1 draw two tiles (c's slot dropped), s2 draws three.
    const late = edl([MIC, src("a"), src("b"), src("c", 7_000)], [seg("s0", 0, "a", "H"), seg("s1", 5, "b", "G"), seg("s2", 10, "c", "P")])
    expect(speakerViewPriceBasis({ edl: late, settings: { layout: "grid" } })).toMatchObject({ maxTiles: 3, tier: "complex" })
    // A hint whose third camera has not begun anywhere it is drawn: two tiles at most.
    const hinted = edl([MIC, src("a"), src("b"), src("c", 60_000)], [seg("s0", 0, "a", "H", hint("grid", ["a", "H"], ["b", "G"], ["c", "P"])), seg("s1", 5, "b", "G")])
    expect(speakerViewPriceBasis({ edl: hinted, settings: { layout: "auto" } })).toMatchObject({ maxTiles: 2, tier: "standard" })
  })

  it("an edit that names no speaker fills a grid from the transcript's labels", () => {
    // Each camera lists who it shows, so every label is placed (else the run is refused).
    const listed = (id: string, speaker: string) => ({ ...src(id), speakers: [speaker] })
    const unnamed = edl([MIC, listed("a", "A"), listed("b", "B"), listed("c", "C")], [seg("s0", 0, "a"), seg("s1", 5, "b"), seg("s2", 10, "c")])
    const transcript = { words: [{ text: "hi", startMs: 0, endMs: 300, speaker: "A" }, { text: "yo", startMs: 400, endMs: 600, speaker: "B" }, { text: "ok", startMs: 700, endMs: 900, speaker: "C" }] }
    expect(tier(unnamed, { layout: "grid" }, transcript)).toBe("complex")
    expect(tier(unnamed, { layout: "grid" }, JSON.stringify(transcript))).toBe("complex")
  })

  it("an edit it cannot read leans high", () => {
    expect(tier(undefined)).toBe("complex")
    expect(tier("{not json")).toBe("complex")
    expect(speakerViewPriceBasis({ edl: { sources: [] } })).toEqual({ tier: "complex", maxTiles: 0, zoom: false })
  })

  it("reads a JSON string edit as the object", () => {
    expect(tier(JSON.stringify(THREE), { layout: "grid" })).toBe("complex")
  })
})

describe("speakerViewSettingsTier — no edit known: never under the run", () => {
  // Side by side, Stacked and Picture-in-picture take two speakers; with three
  // or more the run snaps them to a Grid (`snapLayout`), so without the edit
  // their speaker count — and their tier — is unknown. Only Single cannot
  // gain a tile (review round, finding c4-1).
  it.each([
    [{ layout: "single" }, "standard"],
    [{ layout: "single", switchType: "pan" }, "standard"],
    [{ layout: "single", targetAspect: "9:16" }, "standard"],
    [{ layout: "pip" }, "complex"],
    [{ layout: "side-by-side" }, "complex"],
    [{ layout: "stacked" }, "complex"],
    [{ layout: "side-by-side", targetAspect: "16:9" }, "complex"],
    [{ layout: "stacked", targetAspect: "9:16" }, "complex"],
    [{ layout: "single", switchType: "zoom" }, "complex"],
    [{ layout: "side-by-side", switchType: "zoom" }, "complex"],
    [{ layout: "grid" }, "complex"],
    [{ layout: "auto" }, "complex"],
    [{}, "complex"],
    [{ layout: "nonsense" }, "complex"],
  ])("%j → %s", (data, expected) => {
    expect(speakerViewSettingsTier(data)).toBe(expected)
  })

  // The invariant the hand list above missed: whatever edit turns up, a
  // settings-only Standard is never a Complex run. Every layout × switch ×
  // aspect (and none) over edits of one to six named speakers, and over an
  // edit that names none with a transcript of one to six labels.
  const named = (n: number) => {
    const ids = ["a", "b", "c", "d", "e", "f"].slice(0, n)
    return edl([MIC, ...ids.map((id) => src(id))], ids.map((id, i) => seg(`s${i}`, i * 5, id, `S${i}`)))
  }
  // An edit that names no one is run only on ONE camera (on two or more the
  // run refuses it, "Wire Camera Switch"); the transcript's labels then share
  // that camera's picture.
  const unnamed = (n: number) => edl([MIC, src("a")], Array.from({ length: n }, (_, i) => seg(`s${i}`, i * 5, "a")))
  const transcriptOf = (n: number) => ({ words: Array.from({ length: n }, (_, i) => ({ text: "w", start: i, end: i + 0.5, speaker: `S${i}` })) })
  const runs: Array<{ edl: unknown; transcript?: unknown }> = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ edl: named(n) })),
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ edl: unnamed(n), transcript: transcriptOf(n) })),
    { edl: HINTED_2 },
    { edl: HINTED_3 },
  ]
  const settingsGrid = SPEAKER_LAYOUT_IDS.concat("auto").flatMap((layout) =>
    ["cut", "pan", "zoom"].flatMap((switchType) =>
      [undefined, ...EDL_TARGET_ASPECTS].map((targetAspect) => ({ layout, switchType, ...(targetAspect ? { targetAspect } : {}) }))))

  it("a settings-only Standard is never a Complex run, for any edit", () => {
    const under: string[] = []
    for (const data of settingsGrid) {
      if (speakerViewSettingsTier(data) !== "standard") continue
      for (const run of runs) {
        const settings = speakerViewWireSettings(data, speakerViewContext(run.edl, run.transcript))
        if (speakerViewPriceTier({ edl: run.edl, settings, ...(run.transcript ? { transcript: run.transcript } : {}) }) === "complex") {
          under.push(`${JSON.stringify(data)} over ${JSON.stringify(run.edl).slice(0, 60)}`)
        }
      }
    }
    expect(under).toEqual([])
  })

  it("the reviewed case: three named speakers under Side by side, Stacked or Picture-in-picture run as a Grid, Complex", () => {
    for (const layout of ["side-by-side", "stacked", "pip"]) {
      const settings = speakerViewWireSettings({ layout }, speakerViewContext(THREE))
      expect(settings.layout).toBe("grid")
      expect(speakerViewPriceTier({ edl: THREE, settings })).toBe("complex")
      expect(speakerViewSettingsTier({ layout })).toBe("complex")
    }
  })
})

describe("speakerViewEstimateTier — the edit when known, the settings when not", () => {
  it("quotes the exact tier of a known edit", () => {
    expect(speakerViewEstimateTier({ layout: "auto" }, TWO)).toBe("standard")
    expect(speakerViewEstimateTier({ layout: "grid" }, THREE)).toBe("complex")
    expect(speakerViewEstimateTier({ layout: "grid" }, TWO)).toBe("standard")
  })

  it("a clip batch quotes its dearest clip", () => {
    expect(speakerViewEstimateTier({ layout: "auto" }, [TWO, HINTED_3])).toBe("complex")
    expect(speakerViewEstimateTier({ layout: "auto" }, [TWO, HINTED_2])).toBe("standard")
  })

  it("an unknown edit falls back to the settings", () => {
    expect(speakerViewEstimateTier({ layout: "auto" })).toBe("complex")
    expect(speakerViewEstimateTier({ layout: "single" }, undefined)).toBe("standard")
    expect(speakerViewEstimateTier({ layout: "single" }, "{broken")).toBe("standard")
  })

  it("a grid over an edit that names no one, with no transcript known, cannot be counted: complex", () => {
    const unnamed = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b")])
    expect(speakerViewEstimateTier({ layout: "grid" }, unnamed)).toBe("complex")
    expect(speakerViewEstimateTier({ layout: "single" }, unnamed)).toBe("standard")
  })

  it("an edit that names no one, its transcript wired rather than inline: any layout but Single is complex (finding c4-1 b)", () => {
    // one camera, three speakers: the wired transcript's labels share its picture
    const unnamed3 = edl([MIC, src("a")], [seg("s0", 0, "a"), seg("s1", 5, "a"), seg("s2", 10, "a")])
    const transcript = { words: [0, 1, 2].map((i) => ({ text: "w", start: i, end: i + 0.5, speaker: `S${i}` })) }
    for (const layout of ["side-by-side", "stacked", "pip"]) {
      // the run, with the wired transcript's three labels: a Grid of three
      const run = speakerViewPriceTier({ edl: unnamed3, transcript, settings: speakerViewWireSettings({ layout }, speakerViewContext(unnamed3, transcript)) })
      expect(run).toBe("complex")
      // the estimate, which never sees a wired transcript
      expect(speakerViewEstimateTier({ layout }, unnamed3)).toBe("complex")
    }
    expect(speakerViewEstimateTier({ layout: "single" }, unnamed3)).toBe("standard")
    // a single over an edit carrying its own zoom is still read off the edit
    const zoomed = edl([MIC, src("a"), src("b")], [seg("s0", 0, "a"), seg("s1", 5, "b", undefined, { layout: { mode: "single", transition: { type: "zoom" } } })])
    expect(speakerViewEstimateTier({ layout: "single" }, zoomed)).toBe("complex")
  })
})

describe("resolveSpeakerViewEstimateTier — read off the graph", () => {
  const view = (data: Record<string, unknown> = {}) => ({ id: "view", type: "speaker-view", data })
  const wire = (source: string) => ({ source, target: "view", targetHandle: "edl" })

  it("reads the edit Camera Switch holds", () => {
    const sw = { id: "sw", type: "camera-switch", data: { generatedJson: { edl: HINTED_3 } } }
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto" }), [sw, view()], [wire("sw")], new Set())).toBe("complex")
    const sw2 = { id: "sw", type: "camera-switch", data: { generatedJson: { edl: HINTED_2 } } }
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto" }), [sw2, view()], [wire("sw")], new Set())).toBe("standard")
  })

  it("a producer about to re-run leaves the edit unknown: the settings decide", () => {
    const sw = { id: "sw", type: "camera-switch", data: { generatedJson: { edl: HINTED_2 } } }
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto" }), [sw, view()], [wire("sw")], new Set(["sw"]))).toBe("complex")
    expect(resolveSpeakerViewEstimateTier(view({ layout: "single" }), [sw, view()], [wire("sw")], new Set(["sw"]))).toBe("standard")
    // a two-up layout over an edit not known yet may run as a Grid (finding c4-1 a)
    for (const layout of ["side-by-side", "stacked", "pip"]) {
      expect(resolveSpeakerViewEstimateTier(view({ layout }), [sw, view()], [wire("sw")], new Set(["sw"]))).toBe("complex")
    }
  })

  it("a producer with nothing saved leaves it unknown", () => {
    const sw = { id: "sw", type: "camera-switch", data: {} }
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto" }), [sw, view()], [wire("sw")], new Set())).toBe("complex")
  })

  it("nothing wired: its own inline edit, else its settings; no graph at all reads the same", () => {
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto", edl: TWO }), [], [], new Set())).toBe("standard")
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto" }), [], [], new Set())).toBe("complex")
    expect(resolveSpeakerViewEstimateTier(view({ layout: "auto", edl: TWO }), undefined, undefined, new Set())).toBe("standard")
  })
})

describe("renderEstimateCreditId — the registry's id, with the tier the graph tells", () => {
  it("prices every render, and only renders", () => {
    for (const type of RENDER_NODE_TYPE_IDS) expect(renderEstimateCreditId({ id: "n", type, data: {} }, [], [], new Set())).toBeDefined()
    expect(renderEstimateCreditId({ id: "n", type: "camera-switch", data: {} }, [], [], new Set())).toBeUndefined()
    expect(TIER_PRICED_RENDER_TYPES).toEqual(["speaker-view"])
  })

  it("Speaker View: quality × tier", () => {
    const at = (data: Record<string, unknown>) => renderEstimateCreditId({ id: "v", type: "speaker-view", data }, [], [], new Set())
    expect(at({ layout: "single" })).toBe("speaker-view")
    expect(at({ layout: "single", quality: "proxy" })).toBe("speaker-view:proxy")
    expect(at({ layout: "auto" })).toBe("speaker-view:complex")
    expect(at({ layout: "auto", quality: "proxy" })).toBe("speaker-view:complex:proxy")
  })

  it("Apply EDL: quality alone, as before", () => {
    expect(renderEstimateCreditId({ id: "r", type: "apply-edl", data: { quality: "proxy", output: "audio" } }, [], [], new Set())).toBe("apply-edl:proxy")
    expect(renderEstimateCreditId({ id: "r", type: "apply-edl", data: {} }, undefined, undefined, new Set())).toBe("apply-edl")
  })
})
