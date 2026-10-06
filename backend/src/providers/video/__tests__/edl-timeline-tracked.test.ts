// The EDL timeline's extension for tracked framing (Speaker View v3, phase 3
// P3.8t; SV1 b, decided 2026-10-06). Face tracks reach a render in two ways:
//  - `regionFor` — the D20 resolver rung (`resolveEdlSegmentSlots`), a
//    per-segment tracked region for `motion: static`;
//  - the picture builder — for `motion: glide` it samples the track on the
//    output frame grid, which needs each slot's read window on its SOURCE's
//    own clock and the grid's offset into it.
// And a retried render must never splice a chunk framed for other tracks: the
// checkpoint key is a hash of the command, the picture fragments included, so
// a track change moves exactly the chunks it touches.
import { describe, it, expect } from "vitest"
import type { Edl, EdlRegion, EdlSegment } from "@nodaro/shared"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { chunkOutputMs, resolveChunksForOutput, type PlanSegment } from "../apply-edl-budget.js"
import { buildSliceCommand, type SliceOptions } from "../apply-edl-slice.js"
import { sliceFingerprint } from "../edl-timeline.js"
import { pictureFragmentError, pictureFrameSourceMs, type EdlPictureBuilder, type EdlPictureContext } from "../edl-picture.js"
import { scalePadChain } from "../edl-picture-fullframe.js"

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
  audioPresent: new Map([["W", true], ["A", true], ["MIC", true]]),
}

/** A builder that draws each slot's resolved region — what `static` does. */
const cropToRegion: EdlPictureBuilder = (ctx) => {
  const r = ctx.slots[0]!.region
  return { chain: `crop=iw*${r.w}:ih*${r.h}:iw*${r.x}:ih*${r.y},${scalePadChain(ctx.canvas)}` }
}

const box = (x: number): EdlRegion => ({ x, y: 0, w: 0.4, h: 1 })

describe("regionFor — the resolver rung reaches the timeline", () => {
  const edl = edlOf([src("W"), src("MIC", "audio", { role: "master-audio" })], [
    { id: "s0", inMs: 0, outMs: 2000, video: "W", speaker: "Host" },
    { id: "s1", inMs: 2000, outMs: 4000, video: "W", speaker: "Guest" },
    { id: "s2", inMs: 4000, outMs: 6000, video: "W", speaker: "Host", region: { x: 0, y: 0, w: 0.5, h: 0.5 } },
  ])
  const tracked = { Host: box(0.1), Guest: box(0.5) } as Record<string, EdlRegion>

  it("frames a slot with the track's region, ahead of the static (source, speaker) row — D20 unchanged", () => {
    const seen: EdlPictureContext[] = []
    const cmd = buildSliceCommand(edl, edl.segments, {
      ...OPTS,
      picture: (ctx) => (seen.push(ctx), cropToRegion(ctx)),
      speakerRegions: [{ source: "W", speaker: "Guest", region: box(0.3) }],
      regionFor: ({ speaker }) => (speaker ? tracked[speaker] : undefined),
    })
    expect(seen.map((c) => [c.slots[0]!.regionFrom, c.slots[0]!.region])).toEqual([
      ["resolver", tracked.Host],
      ["resolver", tracked.Guest], // the drawn (W, Guest) row is the fallback, not the winner
      ["segment", { x: 0, y: 0, w: 0.5, h: 0.5 }], // an explicit segment region still wins over a track
    ])
    expect(cmd.filterGraph).toContain("crop=iw*0.4:ih*1:iw*0.5:ih*0,")
  })

  it("without regionFor the command is exactly today's", () => {
    const a = buildSliceCommand(edl, edl.segments, { ...OPTS, picture: cropToRegion })
    const b = buildSliceCommand(edl, edl.segments, { ...OPTS, picture: cropToRegion, regionFor: () => undefined })
    expect(b).toEqual(a)
  })

  it("is asked about the EDL's own segment, never a chunk's split half — a chunk seam is not a segment boundary", () => {
    // A crossfade run longer than the picture cap is closed INSIDE one of its
    // segments (`splitInsideCrossfadeRun`): the halves are `x29~1` / `x29~2`.
    const run = edlOf([src("W"), src("MIC", "audio", { role: "master-audio" })], Array.from({ length: 40 }, (_, i) => ({
      id: `x${i}`, inMs: i * 1000, outMs: (i + 1) * 1000, video: "W", speaker: i % 2 ? "Guest" : "Host",
      ...(i > 0 ? { transition: { type: "crossfade", durationMs: 200 } } : {}),
    })))
    const chunks = resolveChunksForOutput(run.segments, "video")
    const halves = chunks.flat().filter((s) => s.id.includes("~"))
    expect(halves.length).toBeGreaterThan(0) // the fixture does split a segment

    const asked: EdlSegment[] = []
    const regions = new Map<string, EdlRegion>()
    for (const segs of chunks) {
      buildSliceCommand(run, segs, {
        ...OPTS,
        picture: (ctx) => (regions.set(ctx.segment.id, ctx.slots[0]!.region), cropToRegion(ctx)),
        // a per-segment region (a median over the segment's own span)
        regionFor: ({ segment }) => (asked.push(segment), box(segment.inMs / 100_000)),
      })
    }
    for (const q of asked) expect(run.segments).toContain(q)
    for (const half of halves) {
      const whole = half.id.replace(/~[12]$/, "")
      expect(regions.get(half.id), half.id).toEqual(box(run.segments.find((s) => s.id === whole)!.inMs / 100_000))
    }
  })
})

describe("the picture context carries each slot's source-clock span and the output frame grid", () => {
  it("gives each slot its read window on its own source clock (masterMs − offsetMs, D19)", () => {
    const edl = edlOf([src("W", "video", { offsetMs: 4000 }), src("A"), src("MIC", "audio", { role: "master-audio" })], [
      { id: "s0", inMs: 5000, outMs: 7000, video: "W" },
      {
        id: "s1", inMs: 7000, outMs: 9500, video: "W",
        layout: { mode: "side-by-side", slots: [{ source: "W", speaker: "Host" }, { source: "A", speaker: "Guest" }] },
      },
    ])
    const seen: EdlPictureContext[] = []
    const twoUp: EdlPictureBuilder = (ctx) => {
      seen.push(ctx)
      if (ctx.slots.length === 1) return { chain: scalePadChain(ctx.canvas) }
      return { graph: `${ctx.slots[0]!.label}${ctx.slots[1]!.label}hstack=inputs=2${ctx.output}` }
    }
    buildSliceCommand(edl, edl.segments, { ...OPTS, picture: twoUp })
    expect(seen[0]!.slots[0]!.sourceSpan).toEqual({ startMs: 1000, endMs: 3000 })
    expect(seen[1]!.slots.map((s) => s.sourceSpan)).toEqual([{ startMs: 3000, endMs: 5500 }, { startMs: 7000, endMs: 9500 }])
    expect(seen.map((c) => c.leadFrames)).toEqual([0, 0])
    // kept output frame k is the canvas-rate frame at stream time k / fps
    expect(pictureFrameSourceMs(seen[1]!, 0, 0)).toBe(3000)
    expect(pictureFrameSourceMs(seen[1]!, 1, 3)).toBe(7100)
    expect(pictureFrameSourceMs(seen[1]!, 0, seen[1]!.frames - 1)).toBeCloseTo(5500 - 1000 / 30, 6)
  })

  it("a split tail's grid starts where its head stopped — the frames its head rendered are skipped, on the same clock", () => {
    const run = edlOf([src("W", "video", { offsetMs: 500 }), src("MIC", "audio", { role: "master-audio" })], Array.from({ length: 40 }, (_, i) => ({
      id: `x${i}`, inMs: 1000 + i * 1000, outMs: 1000 + (i + 1) * 1000, video: "W",
      ...(i > 0 ? { transition: { type: "crossfade", durationMs: 200 } } : {}),
    })))
    const chunks = resolveChunksForOutput(run.segments, "video")
    const c = chunks.findIndex((segs) => (segs[0] as PlanSegment).splitLeadMs)
    expect(c).toBeGreaterThan(0)
    const tail = chunks[c]![0]!
    const whole = run.segments.find((s) => s.id === tail.id.replace(/~2$/, ""))!
    // the chunk's position on the global output timeline, as the executor hands it
    const chunkStartMs = chunks.slice(0, c).reduce((acc, segs) => acc + chunkOutputMs(segs), 0)
    const seen: EdlPictureContext[] = []
    const cmd = buildSliceCommand(run, chunks[c]!, { ...OPTS, chunkStartMs, picture: (ctx) => (seen.push(ctx), { chain: scalePadChain(ctx.canvas) }) })
    const ctx = seen[0]!
    // the stream is read from the WHOLE segment's start, so its phase is the head's
    expect(ctx.slots[0]!.sourceSpan).toEqual({ startMs: whole.inMs - 500, endMs: whole.outMs - 500 })
    expect(ctx.leadFrames).toBeGreaterThan(0)
    expect(cmd.filterGraph).toContain(`fps=30,trim=start_frame=${ctx.leadFrames}:end_frame=${ctx.leadFrames + ctx.frames},`)
    // its first kept frame is (to within a frame) the split point on the source clock
    expect(Math.abs(pictureFrameSourceMs(ctx, 0, 0) - (tail.inMs - 500))).toBeLessThanOrEqual(1000 / 30)
  })
})

describe("the checkpoint key covers the picture: a track change moves exactly the chunks it touches", () => {
  // 40 one-second cuts on one wide camera, ten per chunk → four chunks. The
  // guest speaks in s12–s17 and s25 (chunks 1 and 2); the host everywhere else.
  const edl = edlOf([src("W"), src("MIC", "audio", { role: "master-audio" })], Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`, inMs: i * 1000, outMs: (i + 1) * 1000, video: "W", speaker: (i >= 12 && i <= 17) || i === 25 ? "Guest" : "Host",
  })))
  const chunks = resolveChunksForOutput(edl.segments, "video", { maxSegmentsPerChunk: 10 })
  const tracks: Record<string, EdlRegion> = { "w/t1": box(0.05), "w/t2": box(0.3), "w/t3": box(0.55) }
  const fingerprints = (opts: Partial<SliceOptions>) =>
    chunks.map((segs) => sliceFingerprint(buildSliceCommand(edl, segs, { ...OPTS, ...opts }), edl, "ffmpeg version n8.1.2"))

  it("static — re-assigning the guest's track re-keys the guest's chunks and no other", () => {
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 10, 10])
    const viaAssignments = (assign: Record<string, string>) => {
      const trackOf = Object.fromEntries(Object.entries(assign).map(([t, speaker]) => [speaker, t]))
      return fingerprints({ picture: cropToRegion, regionFor: ({ speaker }) => (speaker ? tracks[trackOf[speaker]!] : undefined) })
    }
    const before = viaAssignments({ "w/t1": "Host", "w/t2": "Guest" })
    const after = viaAssignments({ "w/t1": "Host", "w/t3": "Guest" })
    expect(after.map((fp, c) => fp !== before[c])).toEqual([false, true, true, false])
  })

  it("glide — moving one box of a track re-keys only the chunk whose frames sample it", () => {
    // A follow path: the crop's x on every kept output frame, sampled from the
    // track on the grid, emitted as a piecewise expression in stream time.
    const glide = (boxes: ReadonlyArray<{ ms: number; x: number }>): EdlPictureBuilder => (ctx) => {
      const xAt = (ms: number) => {
        const k = boxes.findIndex((b) => b.ms > ms)
        if (k <= 0) return (k === 0 ? boxes[0]! : boxes[boxes.length - 1]!).x
        const [a, b] = [boxes[k - 1]!, boxes[k]!]
        return a.x + ((b.x - a.x) * (ms - a.ms)) / (b.ms - a.ms)
      }
      const xs = Array.from({ length: ctx.frames }, (_, k) => xAt(pictureFrameSourceMs(ctx, 0, k)).toFixed(4))
      const expr = xs.map((x, k) => `if(lt(t,${((ctx.leadFrames + k + 1) / ctx.fps).toFixed(6)}),${x},`).join("") + xs[xs.length - 1] + ")".repeat(xs.length)
      return { chain: `crop=iw*0.4:ih:iw*(${expr.replace(/,/g, "\\,")}):0,${scalePadChain(ctx.canvas)}` }
    }
    const path = Array.from({ length: 81 }, (_, i) => ({ ms: i * 500, x: 0.3 }))
    const before = fingerprints({ picture: glide(path) })
    const moved = path.map((b) => (b.ms === 23_500 ? { ...b, x: 0.32 } : b)) // inside s23 → chunk 2
    const after = fingerprints({ picture: glide(moved) })
    expect(after.map((fp, c) => fp !== before[c])).toEqual([false, false, true, false])
  })
})

describe("a picture fragment is the whole picture — it reads no file the key cannot see", () => {
  const ctx = { segment: { id: "s4" }, slots: [{}], output: "[p0o]" } as unknown as EdlPictureContext
  it.each([
    ["a sendcmd command file", { chain: "sendcmd=f=/tmp/glide.cmd,crop=iw/2:ih:0:0" }],
    ["a sendcmd command file, long form", { chain: "sendcmd=filename=/tmp/glide.cmd,crop=iw/2:ih:0:0" }],
    ["a sendcmd command file after inline commands", { chain: "sendcmd=c='0 crop x 1':f=/tmp/glide.cmd,crop=iw/2:ih:0:0" }],
    ["an asendcmd command file", { graph: "[p0s0]asendcmd=f=/tmp/x.cmd[p0o]" }],
    ["a movie source", { graph: "movie=/tmp/logo.png[p0_l];[p0s0][p0_l]overlay[p0o]" }],
    ["an amovie source", { graph: "amovie=/tmp/a.wav[p0_l];[p0s0]null[p0o]" }],
    // ffmpeg's `name@instance` spelling is the same filter
    ["a named sendcmd instance", { chain: "sendcmd@g=f=/tmp/glide.cmd,crop=iw/2:ih:0:0" }],
    ["a named movie instance", { graph: "movie@m=/tmp/logo.png[p0_l];[p0s0][p0_l]overlay[p0o]" }],
    ["a named movie instance after a label", { graph: "[p0s0]null[p0b];[p0_x]movie@logo=/tmp/x.png[p0_l];[p0b][p0_l]overlay[p0o]" }],
  ])("refuses %s", (_why, fragment) => {
    expect(pictureFragmentError(fragment, ctx)).toMatch(/reads a file/)
  })

  it("keeps inline sendcmd commands (the glide fallback when a crop expression grows too long)", () => {
    expect(pictureFragmentError({ chain: "sendcmd=c='0.5 crop x 12',crop=iw/2:ih:0:0" }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ graph: "[p0s0]sendcmd=c='0.0 crop x 10;0.5 crop x 12',crop=iw/2:ih:0:0[p0o]" }, ctx)).toBeUndefined()
    expect(pictureFragmentError({ chain: "crop=iw/2:ih:iw*0.1:0,scale=1080:1920" }, ctx)).toBeUndefined()
  })

  it("the refusal is deterministic: the same fragment fails the same way on every retry", () => {
    const edl = edlOf([src("W"), src("MIC", "audio", { role: "master-audio" })], [{ id: "s4", inMs: 0, outMs: 1000, video: "W" }])
    let err: unknown
    try {
      buildSliceCommand(edl, edl.segments, { ...OPTS, picture: () => ({ chain: "sendcmd=f=/tmp/glide.cmd,null" }) })
    } catch (e) {
      err = e
    }
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String((err as Error).message)).toMatch(/segment "s4".*reads a file/)
  })
})

describe("a regionFor that throws fails the job deterministically, like a picture builder", () => {
  it("surfaces as a DeterministicJobError that names the segment (no retry re-downloads every source)", () => {
    const edl = edlOf([src("W"), src("MIC", "audio", { role: "master-audio" })], [
      { id: "s0", inMs: 0, outMs: 1000, video: "W", speaker: "Host" },
      { id: "s7", inMs: 1000, outMs: 2000, video: "W", speaker: "Ghost" },
    ])
    const tracks = new Map([["Host", { region: box(0.1) }]])
    let err: unknown
    try {
      buildSliceCommand(edl, edl.segments, {
        ...OPTS,
        picture: cropToRegion,
        regionFor: ({ speaker }) => tracks.get(speaker!)!.region,
      })
    } catch (e) {
      err = e
    }
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String((err as Error).message)).toMatch(/region for segment "s7"/)
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(TypeError)
  })
})
