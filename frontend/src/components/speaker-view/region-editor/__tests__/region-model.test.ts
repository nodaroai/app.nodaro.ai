import { describe, it, expect } from "vitest"
import { framingModel, pairKey, regionsToSave, storedRegionOf, cameraIsShared } from "../region-model"

const SOURCES = [
  { id: "wide", url: "https://cdn/wide.mp4", kind: "video", role: "wide" },
  { id: "camA", url: "https://cdn/a.mp4", kind: "video", offsetMs: 4000 },
  { id: "mic", url: "https://cdn/mic.wav", kind: "audio", role: "master-audio" },
]

/** A Camera Switch edit: named segments, one crosstalk hint. */
const SWITCHED = {
  version: 1,
  clock: "master",
  sources: SOURCES,
  segments: [
    { id: "s1", inMs: 0, outMs: 5000, video: "wide", speaker: "Host" },
    { id: "s2", inMs: 5000, outMs: 12_000, video: "wide", speaker: "Guest" },
    { id: "s3", inMs: 12_000, outMs: 20_000, video: "camA", speaker: "Host" },
    { id: "s4", inMs: 20_000, outMs: 26_000, video: "camA", speaker: "Host" },
    {
      id: "s5", inMs: 26_000, outMs: 30_000, video: "wide", speaker: "Guest",
      layout: { mode: "side-by-side", slots: [{ source: "camA", speaker: "Host" }, { source: "wide", speaker: "Guest" }] },
    },
  ],
}

describe("framingModel", () => {
  it("lists each camera's on-screen (source, speaker) pairs, in order of first appearance", () => {
    const m = framingModel([SWITCHED], undefined, { layout: "auto", targetAspect: "16:9" }, undefined)
    expect(m.cameras.map((c) => [c.id, c.pairs.map((p) => p.speaker)])).toEqual([
      ["wide", ["Host", "Guest"]],
      ["camA", ["Host"]],
    ])
    expect(m.cameras.find((c) => c.id === "camA")?.offsetMs).toBe(4000)
    expect(cameraIsShared(m.cameras[0]!)).toBe(true)
    expect(cameraIsShared(m.cameras[1]!)).toBe(false)
  })

  it("lists every slot shape a pair is drawn in — a 9:16 hint renders Stacked (SV4)", () => {
    const m = framingModel([SWITCHED], undefined, { layout: "auto", targetAspect: "9:16" }, undefined)
    const guest = m.cameras[0]!.pairs.find((p) => p.speaker === "Guest")!
    expect(guest.showAs).toEqual([
      { layout: "single", slots: 1, slotIndex: 0, aspect: "9:16" },
      { layout: "stacked", slots: 2, slotIndex: 0, aspect: "9:16" },
    ])
  })

  it("follows a fixed layout setting: the speakers fill its slots (SV3)", () => {
    const m = framingModel([SWITCHED], undefined, { layout: "pip", targetAspect: "16:9" }, undefined)
    const host = m.cameras.find((c) => c.id === "camA")!.pairs[0]!
    // pip: the active speaker is the main picture, the other the inset.
    expect(host.showAs.map((s) => [s.layout, s.slotIndex]).sort()).toEqual([["pip", 0], ["pip", 1]])
  })

  it("merges contiguous same-speaker segments into turns on the master clock", () => {
    const m = framingModel([SWITCHED], undefined, {}, undefined)
    expect(m.turns.filter((t) => t.speaker === "Host")).toEqual([
      { speaker: "Host", startMs: 0, endMs: 5000 },
      { speaker: "Host", startMs: 12_000, endMs: 26_000 },
    ])
  })

  it("an edit naming no one: the speakers come from the transcript's turns on its one camera", () => {
    const plan = {
      version: 1, clock: "master",
      sources: [{ id: "cam", url: "https://cdn/cam.mp4", kind: "video" }],
      segments: [{ id: "a", inMs: 0, outMs: 10_000, video: "cam" }, { id: "b", inMs: 14_000, outMs: 20_000, video: "cam" }],
    }
    const transcript = {
      version: 1,
      words: [
        { text: "so", startMs: 500, endMs: 900, speaker: "speaker_0" },
        { text: "the", startMs: 2000, endMs: 2300, speaker: "speaker_0" },
        { text: "yes", startMs: 4000, endMs: 4500, speaker: "speaker_1" },
        { text: "and", startMs: 15_000, endMs: 15_400, speaker: "speaker_0" },
      ],
    }
    const m = framingModel([plan], JSON.stringify(transcript), {}, undefined)
    expect(m.cameras).toHaveLength(1)
    expect(m.cameras[0]!.pairs.map((p) => [p.speaker, p.firstMs])).toEqual([["speaker_0", 500], ["speaker_1", 4000]])
    // A turn runs until someone else talks — the gap inside speaker_0's first turn does not split it.
    expect(m.turns[0]).toEqual({ speaker: "speaker_0", startMs: 500, endMs: 2300 })
  })

  it("reads every clip of a pack, and skips what is not an edit", () => {
    const clip2 = { ...SWITCHED, segments: [{ id: "x", inMs: 40_000, outMs: 45_000, video: "camA", speaker: "Producer" }] }
    const m = framingModel([SWITCHED, "not json", JSON.stringify(clip2)], undefined, {}, undefined)
    expect(m.cameras.find((c) => c.id === "camA")!.pairs.map((p) => p.speaker)).toEqual(["Host", "Producer"])
  })

  it("knows nothing without an edit", () => {
    expect(framingModel([], undefined, {}, undefined)).toEqual({ cameras: [], turns: [] })
  })
})

describe("saving", () => {
  const model = framingModel([SWITCHED], undefined, {}, undefined)
  const r = (x: number) => ({ x, y: 0, w: 0.3, h: 1 })

  it("writes each drawn box, and keeps stored rows for pairs this edit does not show", () => {
    const boxes = new Map([[pairKey("wide", "Guest"), r(0.6)], [pairKey("wide", "Host"), r(0.1)]])
    const stored = [{ source: "other", speaker: "Old", region: r(0.2) }, { source: "wide", speaker: "Host", region: r(0.5) }, { junk: true }]
    expect(regionsToSave(model, boxes, stored)).toEqual([
      { source: "wide", speaker: "Host", region: r(0.1) },
      { source: "wide", speaker: "Guest", region: r(0.6) },
      { source: "other", speaker: "Old", region: r(0.2) },
    ])
  })

  it("a pair with no box (full frame) is not written", () => {
    expect(regionsToSave(model, new Map(), undefined)).toEqual([])
  })

  it("reads a stored region, ignoring malformed rows", () => {
    expect(storedRegionOf([{ source: "wide", speaker: "Host", region: r(0.1) }], "wide", "Host")).toEqual(r(0.1))
    expect(storedRegionOf([{ source: "wide", speaker: "Host", region: { x: "a" } }], "wide", "Host")).toBeUndefined()
    expect(storedRegionOf("nope", "wide", "Host")).toBeUndefined()
  })
})
