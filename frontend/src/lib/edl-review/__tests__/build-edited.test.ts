import { describe, it, expect } from "vitest"
import { edlDurationMs, normalizeEdl, validateEdl, type Edl } from "@nodaro/shared"
import { buildEdited, isReviewableBase } from "../build-edited"
import { cutRange, keptSetOf, restoreReason, restoreSpan } from "../kept-set"

const iv = (inMs: number, outMs: number) => ({ inMs, outMs })
const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs })

const sources = [
  { id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video" },
  { id: "cam-b", url: "https://cdn.test/b.mp4", kind: "video" },
  { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" },
]

// seg-0 | filler | seg-1 · seg-2 (abutting: a camera split) | tangent, with a silence inside it | seg-3
const plan = normalizeEdl({
  version: 1,
  clock: "master",
  sources,
  segments: [
    { id: "seg-0", inMs: 0, outMs: 1000, video: "cam-a", audio: "mic" },
    { id: "seg-1", inMs: 1300, outMs: 2000, video: "cam-a", audio: "mic" },
    { id: "seg-2", inMs: 2000, outMs: 3000, video: "cam-b", audio: "mic" },
    { id: "seg-3", inMs: 6000, outMs: 7000, video: "cam-a", audio: "mic" },
  ],
  dropped: [
    { inMs: 1000, outMs: 1300, reason: "filler" },
    { inMs: 3000, outMs: 6000, reason: "tangent" },
    { inMs: 3500, outMs: 3800, reason: "silence" },
  ],
  meta: { title: "Episode 12" },
})
const K0 = keptSetOf(plan)
const spans = (edl: Edl) => edl.segments.map((s) => [s.id, s.inMs, s.outMs, s.video])

describe("buildEdited", () => {
  it("with nothing changed, is the plan itself", () => {
    expect(buildEdited(plan, K0)).toEqual(plan)
  })

  it("restoring a gap between two pieces of the same camera joins them; the boundary the plan split at (a camera change) stays", () => {
    const edited = buildEdited(plan, restoreSpan(K0, plan.dropped![0]))
    expect(spans(edited)).toEqual([
      ["seg-0", 0, 2000, "cam-a"],
      ["seg-2", 2000, 3000, "cam-b"],
      ["seg-3", 6000, 7000, "cam-a"],
    ])
    expect(edited.dropped).toEqual([plan.dropped![1], plan.dropped![2]])
  })

  it("restored time between two different cameras takes the preceding camera", () => {
    const edited = buildEdited(plan, restoreReason(K0, plan, "tangent"))
    expect(spans(edited)).toEqual([
      ["seg-0", 0, 1000, "cam-a"],
      ["seg-1", 1300, 2000, "cam-a"],
      ["seg-2", 2000, 6000, "cam-b"],
      ["seg-3", 6000, 7000, "cam-a"],
    ])
    expect(edited.dropped).toEqual([plan.dropped![0]])
  })

  it("a cut inside a segment splits it; the second piece gets a new id; the cut is dropped as manual", () => {
    const edited = buildEdited(plan, cutRange(K0, iv(1400, 1600), [word("the", 1400, 1600)]))
    expect(spans(edited)).toEqual([
      ["seg-0", 0, 1000, "cam-a"],
      ["seg-1", 1300, 1400, "cam-a"],
      ["seg-1@1600", 1600, 2000, "cam-a"],
      ["seg-2", 2000, 3000, "cam-b"],
      ["seg-3", 6000, 7000, "cam-a"],
    ])
    expect(edited.segments[2]).toEqual({ id: "seg-1@1600", inMs: 1600, outMs: 2000, video: "cam-a", audio: "mic" })
    expect(edited.dropped).toEqual([...plan.dropped!, { inMs: 1400, outMs: 1600, reason: "manual" }])
  })

  it("cutting restored time again shows the plan's reason, not manual: K holds no history", () => {
    const k = cutRange(restoreSpan(K0, plan.dropped![0]), iv(1000, 1300), [word("um", 1000, 1300)])
    expect(buildEdited(plan, k)).toEqual(plan)
  })

  it("keeps the plan's sources, meta and the order of its dropped spans", () => {
    const edited = buildEdited(plan, restoreReason(K0, plan, "silence"))
    expect(edited.sources).toEqual(plan.sources)
    expect(edited.meta).toEqual(plan.meta)
    expect(edited.dropped).toEqual([
      plan.dropped![0],
      { inMs: 3000, outMs: 3500, reason: "tangent" },
      { inMs: 3800, outMs: 6000, reason: "tangent" },
    ])
  })

  it("restored time before the plan's first segment takes the first segment's tracks", () => {
    const late = normalizeEdl({
      version: 1,
      clock: "master",
      sources,
      segments: [{ id: "seg-0", inMs: 500, outMs: 2000, video: "cam-b", audio: "mic" }],
      dropped: [{ inMs: 0, outMs: 500, reason: "no-picture" }],
    })
    const edited = buildEdited(late, restoreReason(keptSetOf(late), late, "no-picture"))
    expect(edited.segments).toEqual([{ id: "seg-0@0", inMs: 0, outMs: 2000, video: "cam-b", audio: "mic" }])
    expect(edited.dropped).toEqual([])
  })

  it("a plan with no dropped list gets one only when something is cut", () => {
    const bare = normalizeEdl({ version: 1, clock: "master", sources, segments: [{ id: "s", inMs: 0, outMs: 900, video: "cam-a" }] })
    expect(buildEdited(bare, keptSetOf(bare))).toEqual(bare)
    expect(buildEdited(bare, cutRange(keptSetOf(bare), iv(0, 100), [word("So", 0, 100)])).dropped).toEqual([
      { inMs: 0, outMs: 100, reason: "manual" },
    ])
  })

  it("never mutates the plan", () => {
    const frozen = JSON.stringify(plan)
    buildEdited(plan, restoreReason(cutRange(K0, iv(0, 500), [word("x", 0, 500)]), plan, "tangent"))
    expect(JSON.stringify(plan)).toBe(frozen)
  })
})

describe("buildEdited: transitions", () => {
  // seg-0 · seg-1 (abutting, a crossfade into it) | silence | seg-2 (same look as seg-1, a crossfade
  // into it) | filler | seg-3 (another camera, a layout switch into it)
  const xfade = normalizeEdl({
    version: 1,
    clock: "master",
    sources,
    segments: [
      { id: "seg-0", inMs: 0, outMs: 1000, video: "cam-a" },
      { id: "seg-1", inMs: 1000, outMs: 2000, video: "cam-b", transition: { type: "crossfade", durationMs: 800 } },
      { id: "seg-2", inMs: 2500, outMs: 4000, video: "cam-b", transition: { type: "crossfade", durationMs: 300 } },
      { id: "seg-3", inMs: 4500, outMs: 6000, video: "cam-a", layout: { mode: "single", transition: { type: "xfade:fade", durationMs: 400 } } },
    ],
    dropped: [
      { inMs: 2000, outMs: 2500, reason: "silence" },
      { inMs: 4000, outMs: 4500, reason: "filler" },
    ],
  })
  const k = keptSetOf(xfade)

  it("the plan with its transitions round-trips unchanged", () => {
    expect(buildEdited(xfade, k)).toEqual(xfade)
  })

  it("a segment that becomes the first loses its transition (segments[0] cannot have one)", () => {
    const edited = buildEdited(xfade, cutRange(k, iv(0, 1000), [word("all", 0, 1000)]))
    expect(edited.segments[0]).toEqual({ id: "seg-1", inMs: 1000, outMs: 2000, video: "cam-b" })
    expect(validateEdl(edited).issues).toEqual([])
  })

  it("an overlap transition is shortened to what its new neighbours allow, or removed when nothing is left", () => {
    const shorter = buildEdited(xfade, cutRange(k, iv(1500, 2000), [word("tail", 1500, 2000)]))
    expect(shorter.segments[1].transition).toEqual({ type: "crossfade", durationMs: 450 })
    expect(shorter.segments[2].transition).toEqual({ type: "crossfade", durationMs: 300 })
    const sliver = buildEdited(xfade, cutRange(k, iv(1001, 2000), [word("tail", 1001, 2000)]))
    expect(sliver.segments[1]).toEqual({ id: "seg-1", inMs: 1000, outMs: 1001, video: "cam-b" })
    expect(sliver.segments[2]).toEqual({ id: "seg-2", inMs: 2500, outMs: 4000, video: "cam-b" })
    for (const edl of [shorter, sliver]) expect(validateEdl(edl).issues).toEqual([])
  })

  it("a cut inside a crossfaded segment: the piece after the cut starts no transition, and the length loses only the plan's crossfade", () => {
    const crossfaded = normalizeEdl({
      version: 1,
      clock: "master",
      sources,
      segments: [
        { id: "seg-0", inMs: 0, outMs: 1000, video: "cam-a" },
        { id: "seg-1", inMs: 1000, outMs: 3000, video: "cam-b", transition: { type: "crossfade", durationMs: 800 } },
      ],
    })
    const edited = buildEdited(crossfaded, cutRange(keptSetOf(crossfaded), iv(1500, 1600), [word("the", 1500, 1600)]))
    expect(edited.segments).toEqual([
      { id: "seg-0", inMs: 0, outMs: 1000, video: "cam-a" },
      { id: "seg-1", inMs: 1000, outMs: 1500, video: "cam-b", transition: { type: "crossfade", durationMs: 450 } },
      { id: "seg-1@1600", inMs: 1600, outMs: 3000, video: "cam-b" },
    ])
    // K is 1000 + 500 + 1400 = 2900 ms; only the crossfade into seg-1, shortened to 450 ms, overlaps.
    expect(edlDurationMs(edited)).toBe(2900 - 450)
    expect(validateEdl(edited).issues).toEqual([])
  })

  it("restored time between pieces of the same look joins them, and the transition at the old cut goes", () => {
    const edited = buildEdited(xfade, restoreReason(k, xfade, "silence"))
    expect(spans(edited)).toEqual([
      ["seg-0", 0, 1000, "cam-a"],
      ["seg-1", 1000, 4000, "cam-b"],
      ["seg-3", 4500, 6000, "cam-a"],
    ])
    expect(edited.segments[1].transition).toEqual({ type: "crossfade", durationMs: 800 })
  })

  it("restored time before another camera keeps the boundary but drops its transition: the join is continuous now", () => {
    const edited = buildEdited(xfade, restoreReason(k, xfade, "filler"))
    expect(spans(edited).slice(2)).toEqual([
      ["seg-2", 2500, 4500, "cam-b"],
      ["seg-3", 4500, 6000, "cam-a"],
    ])
    expect(edited.segments[3]).toEqual({ id: "seg-3", inMs: 4500, outMs: 6000, video: "cam-a", layout: { mode: "single" } })
  })

  it("a layout switch moves with its segment's start, and is clamped like a crossfade", () => {
    const edited = buildEdited(xfade, cutRange(k, iv(4900, 6000), [word("end", 4900, 6000)]))
    expect(edited.segments[3]).toEqual({
      id: "seg-3",
      inMs: 4500,
      outMs: 4900,
      video: "cam-a",
      layout: { mode: "single", transition: { type: "xfade:fade", durationMs: 360 } },
    })
    expect(validateEdl(edited).issues).toEqual([])
  })
})

describe("isReviewableBase", () => {
  const base = (segments: Array<Record<string, unknown>>, clock = "master") =>
    normalizeEdl({ version: 1, clock, sources, segments })

  it("a master-clock plan whose segments run forward without overlapping is reviewable", () => {
    expect(isReviewableBase(plan)).toBe(true)
  })

  it("segments out of time order, overlapping, empty or without length are not", () => {
    expect(isReviewableBase(base([{ inMs: 2000, outMs: 3000, video: "cam-a" }, { inMs: 0, outMs: 1000, video: "cam-a" }]))).toBe(false)
    expect(isReviewableBase(base([{ inMs: 0, outMs: 2000, video: "cam-a" }, { inMs: 1000, outMs: 3000, video: "cam-a" }]))).toBe(false)
    expect(isReviewableBase(base([]))).toBe(false)
    expect(isReviewableBase(base([{ inMs: 500, outMs: 500, video: "cam-a" }]))).toBe(false)
  })

  it("an output-clock EDL is not (it re-cuts a rendered file, not the recording)", () => {
    expect(isReviewableBase(base([{ inMs: 0, outMs: 1000, video: "cam-a" }], "output"))).toBe(false)
  })

  it("buildEdited refuses a plan that is not reviewable rather than guessing", () => {
    const tangled = base([{ inMs: 2000, outMs: 3000, video: "cam-a" }, { inMs: 0, outMs: 1000, video: "cam-a" }])
    expect(() => buildEdited(tangled, keptSetOf(tangled))).toThrow(/not reviewable/)
  })
})
