// The frame grid of a chunked apply-edl render (decided 2026-10-05: fix the
// seam half frame). Every 11-segment render the 4K probe planned as chunks
// [10, 1] came out 520 frames over 17.35 s of sound: (15.95 + 1.4) · 30 is
// 520.4999… in floating point, so the slice grid rounded the seam DOWN, while
// the exact position — frame 520.5 — rounds UP to 521. One function now turns
// every output time into a frame index, from integer ms and the rate as a
// fraction (`frameAtMs`); these pin the shape that broke, a sweep over random
// EDLs and chunk plans, and the census of the places that must use it.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { edlDurationMs, type Edl, type EdlSegment } from "@nodaro/shared"
import {
  buildSliceCommand,
  pictureFramesOf,
  resolveChunksForOutput,
  type PlanSegment,
  type SliceOptions,
} from "../apply-edl.js"
import { frameAtMs, frameRate, frameRateOf, type FrameRate } from "../apply-edl-frame-grid.js"

const SOURCES: Edl["sources"] = [
  { id: "A", url: "https://f.test/camA.mp4", kind: "video" },
  { id: "B", url: "https://f.test/camB.mp4", kind: "video" },
  { id: "MIC", url: "https://f.test/master.m4a", kind: "audio", role: "master-audio" },
]

const OPTS: Omit<SliceOptions, "chunkStartMs"> = {
  output: "video",
  quality: "final",
  target: { width: 320, height: 240 },
  fps: 30,
  masterAudioId: "MIC",
  audioPresent: new Map([["A", true], ["B", true], ["MIC", true]]),
  omitAudio: true,
}

/** The count `gridHold` holds a chunk's picture to — what the chunk renders. */
const heldFrames = (g: string): number =>
  Number(/trim=start_frame=0:end_frame=(\d+),setpts=round\(N\/FRAME_RATE\/TB\)\[vout\]/.exec(g)![1])

/** Cut segments of the given lengths, alternating cameras (each read from 0). */
const cuts = (lens: readonly number[]): EdlSegment[] =>
  lens.map((len, i) => ({ id: `s${i}`, inMs: 0, outMs: len, video: i % 2 === 0 ? "A" : "B" }) as EdlSegment)

/** What `applyEdl` does with a chunk plan, per picture chunk: its global start
 *  (ms, Σ of the chunks before it) and the frames its slice command holds. A
 *  chunk that rounds to no frame renders no picture (`skipsPicture`), unless
 *  no chunk has one. */
function renderChunks(chunks: readonly (readonly PlanSegment[])[], fps: number) {
  const edl = { version: 1, clock: "master", sources: SOURCES, segments: chunks.flat() } as unknown as Edl
  const frames = pictureFramesOf(chunks, fps)
  const skips = (c: number) => frames[c] === 0 && frames.some((n) => n > 0)
  let startMs = 0
  return chunks.map((segs, c) => {
    const held = skips(c) ? 0 : heldFrames(buildSliceCommand(edl, segs, { ...OPTS, fps, chunkStartMs: startMs }).filterGraph)
    const out = { startMs, planned: frames[c]!, held }
    startMs += chunkMs(segs)
    return out
  })
}

/** A chunk's output length in ms, re-derived here (not the code under test):
 *  Σ durations minus each internal crossfade, clamped as the validator bounds it. */
function chunkMs(segs: readonly EdlSegment[]): number {
  return segs.reduce((acc, s, i) => {
    const t = s.transition as { type?: string; durationMs?: number } | undefined
    const ov = i > 0 && t?.type === "crossfade"
      ? Math.min(t.durationMs ?? 0, Math.floor(0.9 * Math.min(s.outMs - s.inMs, segs[i - 1]!.outMs - segs[i - 1]!.inMs)))
      : 0
    return acc + (s.outMs - s.inMs) - ov
  }, 0)
}

describe("frameAtMs — exact grid boundaries from integer ms and a rational rate", () => {
  it("rounds an exact half frame UP, whatever float would make of the sum", () => {
    expect(frameAtMs(17_350, frameRate(30))).toBe(521) // 520.5 — float (15.95 + 1.4)·30 says 520.4999…
    expect(frameAtMs(15_950, frameRate(30))).toBe(479) // 478.5
    expect(frameAtMs(17_340, frameRate(25))).toBe(434) // 433.5
    expect(frameAtMs(50_000, frameRate(2997, 100))).toBe(1499) // 1498.5
    expect(frameAtMs(49, frameRate(30))).toBe(1) // 1.47
    expect(frameAtMs(0, frameRate(30))).toBe(0)
  })

  it("is exact at NTSC rates as fractions, hours into a render", () => {
    const ntsc = frameRate(30_000, 1001)
    // 3 h = 10 800 000 ms → 323 676.323… frames.
    expect(frameAtMs(10_800_000, ntsc)).toBe(323_676)
    expect(frameAtMs(1001, ntsc)).toBe(30)
    expect(frameAtMs(10_800_000, frameRate(24_000, 1001))).toBe(258_941) // 258 941.058…
  })

  it("takes the canvas rate losslessly from the 0.001-keyed fps the render picks", () => {
    expect(frameRateOf(30)).toEqual({ num: 30, den: 1 })
    expect(frameRateOf(29.97)).toEqual({ num: 2997, den: 100 })
    expect(frameRateOf(23.976)).toEqual({ num: 2997, den: 125 })
    expect(frameRateOf(59.94)).toEqual({ num: 2997, den: 50 })
    expect(() => frameRateOf(30000 / 1001)).toThrow(RangeError)
    expect(() => frameRateOf(0)).toThrow(RangeError)
  })

  it("refuses a position that is not a whole millisecond (a float re-derivation)", () => {
    expect(() => frameAtMs(17_349.999999999998, frameRate(30))).toThrow(RangeError)
    expect(() => frameAtMs(Number.NaN, frameRate(30))).toThrow(RangeError)
  })
})

describe("the [10, 1] chunk shape the 4K probe found holds every frame of its sound", () => {
  // 11 cuts, planned as chunks [10, 1]; each total lands exactly on a half
  // frame that float arithmetic rounded the wrong way.
  const SHAPES: ReadonlyArray<{ fps: number; lens: number[]; totalMs: number; frames: number }> = [
    { fps: 30, lens: [...Array(9).fill(1500), 2450, 1400], totalMs: 17_350, frames: 521 },
    { fps: 25, lens: [...Array(9).fill(1000), 8120, 220], totalMs: 17_340, frames: 434 },
    { fps: 29.97, lens: [...Array(9).fill(1010), 40_680, 230], totalMs: 50_000, frames: 1499 },
  ]

  for (const { fps, lens, totalMs, frames } of SHAPES) {
    it(`at ${fps} fps: ${frames} frames over ${totalMs} ms, chunk counts and seams on the global grid`, () => {
      const segs = cuts(lens)
      const chunks = resolveChunksForOutput(segs, "video", { chunkThreshold: 10, maxSegmentsPerChunk: 10 })
      expect(chunks.map((c) => c.length)).toEqual([10, 1])
      const rate = frameRateOf(fps)
      expect(edlDurationMs({ version: 1, clock: "master", sources: SOURCES, segments: segs } as Edl)).toBe(totalMs)
      expect(frameAtMs(totalMs, rate)).toBe(frames)

      const rendered = renderChunks(chunks, fps)
      expect(rendered.map((r) => r.held)).toEqual(rendered.map((r) => r.planned))
      expect(rendered.reduce((a, r) => a + r.held, 0)).toBe(frames)
      // The seam: chunk 1 starts on the global grid's frame for its position.
      expect(rendered[0]!.held).toBe(frameAtMs(rendered[1]!.startMs, rate))
    })
  }
})

/** Integer-exact PRNG (mulberry32). */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("any valid EDL, any chunk plan: the slices hold exactly the edit's frames, every seam on the global grid", () => {
  const rnd = mulberry32(20261005)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

  /** A valid EDL's segments: whole-ms lengths on a 10/25 ms raster (where half
   *  frames fall at 24–60 fps) — sub-frame slivers included — with cuts and
   *  crossfades within the validator's 0.9·min(adjacent) bound. */
  function randomSegments(): EdlSegment[] {
    const n = 2 + Math.floor(rnd() * 40)
    const step = pick([10, 25])
    const lens = Array.from({ length: n }, () => step * (2 + Math.floor(rnd() * pick([4, 40, 400]))))
    return lens.map((len, i) => {
      const seg = { id: `r${i}`, inMs: 0, outMs: len, video: pick(["A", "B"]) } as EdlSegment
      if (i === 0 || rnd() < 0.7) return seg
      const maxD = Math.floor(0.9 * Math.min(len, lens[i - 1]!))
      const d = Math.floor((1 + rnd() * maxD) / step) * step
      return d >= step && d <= maxD ? ({ ...seg, transition: { type: "crossfade", durationMs: d } } as EdlSegment) : seg
    })
  }

  it("Σ slice frames === round(total·F) and each chunk starts on round(start·F), at 24–60 fps", () => {
    let ties = 0
    let seams = 0
    for (let k = 0; k < 1500; k++) {
      const segments = randomSegments()
      const fps = pick([24, 25, 29.97, 30, 50, 59.94, 60])
      const rate: FrameRate = frameRateOf(fps)
      const per = 1 + Math.floor(rnd() * 8)
      const chunks = resolveChunksForOutput(segments, "video", { chunkThreshold: per, maxSegmentsPerChunk: per })
      const edl = { version: 1, clock: "master", sources: SOURCES, segments } as Edl
      const totalMs = edlDurationMs(edl)
      const rendered = renderChunks(chunks, fps)
      const label = `${JSON.stringify(segments)} @${fps} per ${per}`

      for (const r of rendered) {
        if (r.startMs > 0) {
          seams++
          if ((2 * r.startMs * rate.num) % (rate.den * 1000) === 0 && ((2 * r.startMs * rate.num) / (rate.den * 1000)) % 2 === 1) ties++
        }
        // The seam boundary IS the global grid boundary of its position.
        const before = rendered.filter((x) => x.startMs < r.startMs).reduce((a, x) => a + x.held, 0)
        expect(before, `seam at ${r.startMs} ms — ${label}`).toBe(frameAtMs(r.startMs, rate))
        expect(r.held, label).toBe(r.planned)
      }
      expect(rendered.reduce((a, r) => a + r.held, 0), label).toBe(frameAtMs(totalMs, rate))
    }
    expect(seams).toBeGreaterThan(5000)
    expect(ties).toBeGreaterThan(50) // the sweep really lands seams on exact half frames
  })
})

describe("census — every time → frame index in the apply-edl render goes through frameAtMs", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const videoDir = join(here, "..")
  const renderRules = join(here, "../../../../../packages/render-rules/src/apply-edl.ts")
  // Every apply-edl render module, present and future, plus the render rule.
  const files = [
    ...readdirSync(videoDir).filter((f) => /^apply-edl.*\.ts$/.test(f) && f !== "apply-edl-frame-grid.ts").map((f) => join(videoDir, f)),
    renderRules,
  ]
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  // A time scaled by a rate (`x * fps`, `fps * x`, `Math.round(… fps …)`): the
  // shape that rounds a float sum. Frame → time (`frames / fps`, an xfade's
  // duration and offset, the read guard) is not a grid boundary and is allowed.
  const TIME_TO_FRAME = [/\*\s*(?:[\w.]+\.)?fps\b/, /\bfps\s*\*/, /Math\.(?:round|floor|ceil|trunc)\([^;]*\bfps\b/]

  it("covers the modules it must (slice, executor, budget)", () => {
    const names = files.map((f) => f.split("/").pop())
    expect(names).toEqual(expect.arrayContaining(["apply-edl.ts", "apply-edl-slice.ts", "apply-edl-budget.ts"]))
  })

  it("no apply-edl module scales a time by the fps itself", () => {
    const offenders: string[] = []
    for (const f of files) {
      stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
        if (TIME_TO_FRAME.some((re) => re.test(line))) offenders.push(`${f.split("/").pop()}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it("the slice grid and the executor's totals both take their boundaries from frameAtMs", () => {
    for (const name of ["apply-edl-slice.ts"]) {
      const src = readFileSync(join(videoDir, name), "utf8")
      expect(src).toMatch(/from "\.\/apply-edl-frame-grid\.js"/)
      expect(src).toMatch(/frameAtMs\(/)
    }
    // The executor's per-chunk totals are `pictureFramesOf` (slice module).
    expect(readFileSync(join(videoDir, "apply-edl.ts"), "utf8")).toMatch(/pictureFramesOf\(chunks, fps\)/)
  })
})
