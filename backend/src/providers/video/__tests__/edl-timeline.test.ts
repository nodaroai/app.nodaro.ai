// The EDL timeline's two new powers (Speaker View C2.0, SV1 b): a PICTURE seam
// (a builder draws each segment's slots; the timeline keeps the grid, the
// seeks, the sound and the budgets), and the `xfade:<id>` layout switch as a
// join. Apply EDL's own graphs are pinned byte-for-byte by
// `apply-edl-golden.test.ts`; this file pins what is new.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { SPEAKER_SWITCHES, edlDurationMs, resolveXfadeName } from "@nodaro/shared"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  boundaryOverlapMs,
  chunkOutputMs,
  chunkRenderTimeoutMs,
  edlTimelineRenderBudgetMs,
  applyEdlRenderBudgetMs,
  LIVENESS_CANVAS,
  maxPictureSlots,
  pictureSourceIdsOf,
  referencedSourceIds,
  resolveChunksForOutput,
  splitInsideCrossfadeRun,
  videoSegmentCap,
  VIDEO_FILTERGRAPH_MAX_SEGMENTS,
} from "../apply-edl-budget.js"
import { assertEdlSwitchesResolve, buildSliceCommand, xfadeTransitionInto, type SliceOptions } from "../apply-edl-slice.js"
import { assertSegmentsWithinSources } from "../edl-timeline.js"
import type { EdlPictureBuilder, EdlPictureContext } from "../edl-picture.js"
import { fullFramePicture, scalePadChain } from "../edl-picture-fullframe.js"

const src = (id: string, kind: "video" | "audio" = "video", extra: Record<string, unknown> = {}) =>
  ({ id, url: `https://f.test/${id}`, kind, ...extra })
const edlOf = (sources: unknown[], segments: unknown[]): Edl => ({ version: 1, clock: "master", sources, segments } as unknown as Edl)

const OPTS: SliceOptions = {
  output: "video",
  quality: "final",
  target: { width: 1080, height: 1920 },
  fps: 30,
  chunkStartMs: 0,
  masterAudioId: "MIC",
  audioPresent: new Map([["A", true], ["B", true], ["W", true], ["MIC", true]]),
}

const switchInto = (type: string, durationMs?: number) => ({ mode: "single", transition: { type, ...(durationMs !== undefined ? { durationMs } : {}) } })

describe("xfade:<id> — a layout switch joins with the combine-videos transition it names (D17)", () => {
  it("names fade for a crossfade, the catalog's xfade for an xfade: switch", () => {
    expect(xfadeTransitionInto({ id: "s", inMs: 0, outMs: 1, transition: { type: "crossfade", durationMs: 300 } } as EdlSegment)).toBe("fade")
    expect(xfadeTransitionInto({ id: "s", inMs: 0, outMs: 1, layout: switchInto("xfade:wipe-left", 400) } as EdlSegment)).toBe("wipeleft")
  })

  it("refuses an xfade: id the catalog does not know, deterministically (the retry fails the same way)", () => {
    let err: unknown
    try {
      xfadeTransitionInto({ id: "s7", inMs: 0, outMs: 1, layout: switchInto("xfade:warp-drive", 400) } as EdlSegment)
    } catch (e) {
      err = e
    }
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String((err as Error).message)).toMatch(/s7.*xfade:warp-drive/)
  })

  it("checks every switch before any download — even one whose blend rounds under a frame, and on a sound-only render", () => {
    const tiny = edlOf([src("A"), src("B"), src("MIC", "audio", { role: "master-audio" })], [
      { id: "s0", inMs: 0, outMs: 3000, video: "A" },
      { id: "s1", inMs: 3000, outMs: 6000, video: "B", layout: switchInto("xfade:warp-drive", 10) },
    ])
    let err: unknown
    try {
      assertEdlSwitchesResolve(tiny)
    } catch (e) {
      err = e
    }
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String((err as Error).message)).toMatch(/s1.*xfade:warp-drive/)
    // a crossfade on the same segment does not hide the switch it also names
    const both = edlOf(tiny.sources as unknown[], [tiny.segments[0], { ...tiny.segments[1], transition: { type: "crossfade", durationMs: 300 } }])
    expect(() => assertEdlSwitchesResolve(both)).toThrow(/xfade:warp-drive/)
    // known switches, cuts and no layout pass
    const ok = edlOf(tiny.sources as unknown[], [
      tiny.segments[0],
      { id: "s1", inMs: 3000, outMs: 6000, video: "B", layout: switchInto("xfade:wipe-left", 10) },
      { id: "s2", inMs: 6000, outMs: 7000, video: "A", layout: switchInto("cut") },
    ])
    expect(() => assertEdlSwitchesResolve(ok)).not.toThrow()
  })

  it("every time-consuming switch in the published registry resolves to a real ffmpeg xfade (totality)", () => {
    const overlapping = SPEAKER_SWITCHES.filter((s) => s.overlaps)
    expect(overlapping.length).toBeGreaterThan(10)
    for (const sw of overlapping) {
      const seg = { id: "s", inMs: 0, outMs: 1, layout: switchInto(sw.id, 300) } as EdlSegment
      expect(xfadeTransitionInto(seg), sw.id).toBe(resolveXfadeName(sw.id.slice("xfade:".length)))
    }
  })

  it("consumes its overlap like a crossfade — and only the xfade family does; cut, pan and zoom consume nothing", () => {
    const prev = { id: "p", inMs: 0, outMs: 3000, video: "A" } as EdlSegment
    const into = (layout: unknown) => ({ id: "n", inMs: 9000, outMs: 12_000, video: "B", layout } as EdlSegment)
    expect(boundaryOverlapMs(into(switchInto("xfade:wipe-left", 400)), prev)).toBe(400)
    expect(boundaryOverlapMs(into(switchInto("xfade:wipe-left", 5000)), prev)).toBe(2700) // the 0.9·min clamp
    for (const t of ["cut", "pan", "zoom"]) expect(boundaryOverlapMs(into(switchInto(t, 600)), prev), t).toBe(0)
    expect(boundaryOverlapMs(into(switchInto("xfade:wipe-left")), prev)).toBe(0) // no duration
  })

  // F8's graph half: the join is the named wipe, the sound blends over the same
  // window (SV21 c, decided 2026-10-06), and the render's length is the
  // contract's own `edlDurationMs`.
  it("draws an xfade: switch as that wipe over the picture and a crossfade over the sound, the overlap off the length", () => {
    const edl = edlOf([src("A"), src("B"), src("MIC", "audio", { role: "master-audio" })], [
      { id: "s0", inMs: 0, outMs: 3000, video: "A" },
      { id: "s1", inMs: 9000, outMs: 12_000, video: "B", layout: switchInto("xfade:wipe-left", 400) },
    ])
    const cmd = buildSliceCommand(edl, edl.segments, OPTS)
    expect(cmd.filterGraph).toContain("xfade=transition=wipeleft:duration=")
    expect(cmd.filterGraph).toContain("acrossfade=d=0.400000")
    expect(chunkOutputMs(edl.segments)).toBe(edlDurationMs(edl))
    expect(edlDurationMs(edl)).toBe(5600)
  })

  it("closes a long run of xfade: switches at a cut made inside a segment; the tail keeps its layout but not the switch", () => {
    const seg = { id: "s1", inMs: 1000, outMs: 4000, video: "B", layout: { slots: [{ source: "B" }], ...switchInto("xfade:dissolve", 300) } } as unknown as EdlSegment
    const prev = { id: "s0", inMs: 0, outMs: 1000, video: "A" } as EdlSegment
    const next = { id: "s2", inMs: 4000, outMs: 5000, video: "A", layout: switchInto("xfade:dissolve", 300) } as unknown as EdlSegment
    const split = splitInsideCrossfadeRun(prev, seg, next)!
    expect(split).toBeDefined()
    expect(split.head.layout?.transition?.type).toBe("xfade:dissolve")
    expect(split.tail.layout?.transition).toBeUndefined()
    expect(split.tail.layout?.slots).toEqual([{ source: "B" }])
    expect(boundaryOverlapMs(split.tail, split.head)).toBe(0)
  })
})

describe("the picture seam — slots come from the EDL, the builder draws them", () => {
  const two = edlOf([src("W"), src("A"), src("MIC", "audio", { role: "master-audio" })], [
    { id: "s0", inMs: 0, outMs: 2000, video: "W", speaker: "Host" },
    {
      id: "s1", inMs: 2000, outMs: 4500, video: "W",
      layout: { mode: "side-by-side", slots: [{ source: "W", speaker: "Host" }, { source: "A", speaker: "Guest", weight: 1 }] },
    },
  ])
  const seen: EdlPictureContext[] = []
  const grid: EdlPictureBuilder = (ctx) => {
    seen.push(ctx)
    if (ctx.slots.length === 1) return { chain: `crop=iw/2:ih:0:0,${scalePadChain(ctx.canvas)}` }
    const s = ctx.scope
    return {
      graph: ctx.slots.map((slot, j) => `${slot.label}scale=540:1920,setsar=1[${s}t${j}]`).join(";") +
        `;[${s}t0][${s}t1]hstack=inputs=2${ctx.output}`,
    }
  }
  const regions = [{ source: "W", speaker: "Host", region: { x: 0.1, y: 0, w: 0.3, h: 1 } }]

  it("hands the builder every slot read on the grid, with D20's regions resolved, and conforms its output to the segment's exact frames", () => {
    seen.length = 0
    const cmd = buildSliceCommand(two, two.segments, { ...OPTS, picture: grid, speakerRegions: regions })
    expect(cmd.inputIds).toEqual(["W", "MIC", "A"])
    // segment 0: one slot, a chain inlined into its read, the speaker's region resolved
    expect(seen[0]!.slots).toEqual([{ source: "W", speaker: "Host", region: regions[0]!.region, regionFrom: "speaker", label: "[p0s0]" }])
    expect(cmd.filterGraph).toContain("setpts=PTS-STARTPTS,crop=iw/2:ih:0:0,scale=1080:1920")
    // segment 1: two labelled slot reads, the fragment, the conform
    expect(seen[1]!.slots.map((s) => [s.source, s.label, s.regionFrom])).toEqual([["W", "[p1s0]", "speaker"], ["A", "[p1s1]", "full"]])
    expect(cmd.filterGraph).toMatch(/\[0:V\]tpad=stop_mode=clone:stop=-1,trim=start=[\d.]+:end=[\d.]+,setpts=PTS-STARTPTS\[p1s0\]/)
    expect(cmd.filterGraph).toMatch(/\[2:V\]tpad=stop_mode=clone:stop=-1,trim=start=[\d.]+:end=[\d.]+,setpts=PTS-STARTPTS\[p1s1\]/)
    expect(cmd.filterGraph).toContain(`[p1o]fps=30,trim=start_frame=0:end_frame=${seen[1]!.frames},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v1]`)
    // the grid: 2.0 s then 2.5 s at 30 fps
    expect(seen.map((c) => [c.frames, c.startFrame])).toEqual([[60, 0], [75, 60]])
    expect(seen[1]!).toMatchObject({ canvas: { width: 1080, height: 1920 }, fps: 30, durationSec: 2.5, leadSec: 0, output: "[p1o]", scope: "p1_" })
  })

  it("reserves memory for every slot branch (#1860 counts graph branches) and charges the slice for them", () => {
    const cmd = buildSliceCommand(two, two.segments, { ...OPTS, picture: grid })
    expect(cmd.memoryBasis).toEqual({ width: 1080, height: 1920, segments: 3 })
    // long enough that the kill budget is past its 2-minute floor
    const long = edlOf(two.sources as unknown[], two.segments.map((s, i) => ({ ...s, inMs: i * 90_000, outMs: (i + 1) * 90_000 })))
    const oneSlot = edlOf(two.sources as unknown[], long.segments.map(({ layout: _l, ...s }) => s))
    expect(buildSliceCommand(long, long.segments, { ...OPTS, picture: grid }).timeoutMs)
      .toBeGreaterThan(buildSliceCommand(oneSlot, oneSlot.segments, OPTS).timeoutMs)
  })

  it("lets a one-slot segment draw through a graph too (a 9:16 single that fills its background)", () => {
    const one = edlOf(two.sources as unknown[], [two.segments[0]])
    const graphOnOne: EdlPictureBuilder = (ctx) => ({ graph: `${ctx.slots[0]!.label}null${ctx.output}` })
    const cmd = buildSliceCommand(one, one.segments, { ...OPTS, picture: graphOnOne })
    expect(cmd.filterGraph).toMatch(/setpts=PTS-STARTPTS\[p0s0\];\[p0s0\]null\[p0o\];\[p0o\]fps=30,trim=start_frame=0:end_frame=60,/)
  })

  it("refuses a fragment that would break the graph around it", () => {
    const chainOnTwo: EdlPictureBuilder = () => ({ chain: "scale=10:10" })
    expect(() => buildSliceCommand(two, two.segments, { ...OPTS, picture: chainOnTwo })).toThrow(/chain draws one slot; segment "s1" has 2/)
    const noOutput: EdlPictureBuilder = (ctx) => (ctx.slots.length === 1 ? { chain: "null" } : { graph: "[p1s0][p1s1]hstack[elsewhere]" })
    expect(() => buildSliceCommand(two, two.segments, { ...OPTS, picture: noOutput })).toThrow(/must write \[p1o\]/)
    const labelled: EdlPictureBuilder = () => ({ chain: "scale=10:10[x]" })
    expect(() => buildSliceCommand(edlOf(two.sources as unknown[], [two.segments[0]]), [two.segments[0]!], { ...OPTS, picture: labelled })).toThrow(/linear filter chain/)
  })

  it("refuses a bad fragment, a slot-less segment and a builder that throws as deterministic (a pure builder fails the same way on every retry)", () => {
    const refusal = (run: () => unknown): unknown => {
      try {
        run()
      } catch (e) {
        return e
      }
      return undefined
    }
    const noOutput: EdlPictureBuilder = (ctx) => (ctx.slots.length === 1 ? { chain: "null" } : { graph: "[p1s0][p1s1]hstack[elsewhere]" })
    const missing = refusal(() => buildSliceCommand(two, two.segments, { ...OPTS, picture: noOutput }))
    expect(isDeterministicJobError(missing)).toBe(true)
    expect(String((missing as Error).message)).toMatch(/segment "s1".*must write \[p1o\]/)
    const chainOnTwo = refusal(() => buildSliceCommand(two, two.segments, { ...OPTS, picture: () => ({ chain: "scale=10:10" }) }))
    expect(isDeterministicJobError(chainOnTwo)).toBe(true)
    const throws: EdlPictureBuilder = () => {
      throw new Error("no layout for 3 slots")
    }
    const thrown = refusal(() => buildSliceCommand(two, two.segments, { ...OPTS, picture: throws }))
    expect(isDeterministicJobError(thrown)).toBe(true)
    expect(String((thrown as Error).message)).toMatch(/segment "s0".*no layout for 3 slots/)
    const slotless = edlOf([src("A"), src("MIC", "audio", { role: "master-audio" })], [{ id: "s9", inMs: 0, outMs: 1000 }])
    const none = refusal(() => buildSliceCommand(slotless, slotless.segments, OPTS))
    expect(isDeterministicJobError(none)).toBe(true)
    expect(String((none as Error).message)).toMatch(/segment "s9" has no picture source/)
  })

  it("the default picture is the full frame, exactly Apply EDL's chain", () => {
    expect(fullFramePicture({ canvas: { width: 1280, height: 720 } } as EdlPictureContext)).toEqual({
      chain: "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
    })
  })

  it("downloads, window-checks and budgets every slot source", () => {
    expect(pictureSourceIdsOf(two, two.segments[1]!)).toEqual(["W", "A"])
    expect([...referencedSourceIds(two, "video")]).toEqual(["W", "MIC", "A"])
    expect(maxPictureSlots(two, two.segments)).toBe(2)
    const ends = new Map([
      ["W", { video: { state: "measured", endSec: 100 }, audio: { state: "measured", endSec: 100 } }],
      ["A", { video: { state: "measured", endSec: 3 }, audio: { state: "measured", endSec: 3 } }],
      ["MIC", { video: { state: "absent" }, audio: { state: "measured", endSec: 100 } }],
    ]) as never
    expect(() => assertSegmentsWithinSources(two, "MIC", true, ends, "speaker-view")).toThrow(
      /^speaker-view: segment\[1\] "s1" ends at 4\.50s on source "A", but its video track is only 3\.00s long/,
    )
  })
})

describe("the plan and the budget count picture branches", () => {
  const cuts = (n: number, layout?: unknown): Edl =>
    edlOf([src("A"), src("B")], Array.from({ length: n }, (_, i) => ({ id: `s${i}`, inMs: i * 1000, outMs: (i + 1) * 1000, video: i % 2 ? "B" : "A", ...(layout ? { layout } : {}) })))

  it("divides the picture cap by the slots each segment composites; one slot is Apply EDL's cap", () => {
    expect(videoSegmentCap()).toBe(VIDEO_FILTERGRAPH_MAX_SEGMENTS)
    expect(videoSegmentCap(1)).toBe(30)
    expect(videoSegmentCap(2)).toBe(15)
    expect(videoSegmentCap(6)).toBe(5)
    expect(videoSegmentCap(40)).toBe(1)
    const edl = cuts(60)
    expect(resolveChunksForOutput(edl.segments, "video").map((c) => c.length)).toEqual([30, 30])
    expect(resolveChunksForOutput(edl.segments, "video", { pictureSlots: 6 }).map((c) => c.length)).toEqual(Array(12).fill(5))
    expect(resolveChunksForOutput(edl.segments, "audio", { pictureSlots: 6 }).map((c) => c.length)).toEqual([30, 30])
  })

  it("charges each composited slot's branch, and assumes a dispatch-time worst case when the layouts are not written yet", () => {
    const one = cuts(5)
    const sbs = cuts(5, { mode: "side-by-side", slots: [{ source: "A" }, { source: "B" }] })
    const reads = { video: true, audio: true }
    const oneMs = chunkRenderTimeoutMs(one, one.segments, reads, LIVENESS_CANVAS)
    expect(chunkRenderTimeoutMs(sbs, sbs.segments, reads, LIVENESS_CANVAS)).toBeGreaterThan(oneMs)
    expect(chunkRenderTimeoutMs(one, one.segments, reads, LIVENESS_CANVAS, 6)).toBeGreaterThan(chunkRenderTimeoutMs(one, one.segments, reads, LIVENESS_CANVAS, 2))
    // the worst case is a bound, never below the layout it stands in for
    expect(edlTimelineRenderBudgetMs(one, { assumeSlots: 2 })).toBeGreaterThanOrEqual(edlTimelineRenderBudgetMs(sbs))
    // Apply EDL's budget is the timeline's with no assumption
    expect(applyEdlRenderBudgetMs(one)).toBe(edlTimelineRenderBudgetMs(one))
  })
})
