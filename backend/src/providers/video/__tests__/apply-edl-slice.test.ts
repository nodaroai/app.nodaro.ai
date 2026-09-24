// `buildSliceCommand` is pure: it decides EVERYTHING a slice renders (filter
// graph, encode arguments, input order) without touching the filesystem, so a
// chunk's resume key can be a hash of exactly that (`sliceFingerprint`). These
// pin the two properties the resume path depends on — the key moves whenever
// the render would, and never because of per-run local paths — and the
// crossfade chunk's end-of-chunk hold to the frame grid (Track 0.14).
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { buildSliceCommand, chunkOutputSec, sliceFingerprint, INPUT_SEEK_MARGIN_SEC, type PlanSegment, type SliceOptions } from "../apply-edl.js"

const EDL: Edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "A", url: "https://f.test/camA.mp4", kind: "video" },
    { id: "B", url: "https://f.test/camB.mp4", kind: "video" },
    { id: "MIC", url: "https://f.test/master.m4a", kind: "audio", role: "master-audio" },
  ],
  segments: Array.from({ length: 6 }, (_, k) => ({
    id: `s${k}`, inMs: k * 617, outMs: (k + 1) * 617, video: k % 2 === 0 ? "A" : "B",
  })),
} as unknown as Edl

const OPTS: SliceOptions = {
  output: "video",
  quality: "final",
  target: { width: 320, height: 240 },
  fps: 30,
  chunkStartSec: 0,
  masterAudioId: "MIC",
  audioPresent: new Map([["A", true], ["B", true], ["MIC", true]]),
}

const cmd = (over: Partial<SliceOptions> = {}, segs: readonly EdlSegment[] = EDL.segments, edl: Edl = EDL) =>
  buildSliceCommand(edl, segs, { ...OPTS, ...over })

describe("buildSliceCommand — a pure description of the render", () => {
  it("names sources by id, never by a local path, and leaves the output path to the runner", () => {
    const c = cmd()
    expect(c.inputIds).toEqual(["A", "MIC", "B"])
    expect(c.filterGraph).not.toMatch(/\.mp4|\.m4a|\.wav|\/tmp|\/var/)
    expect(c.outputArgs.join(" ")).not.toMatch(/\.mp4|\.m4a|\.wav/)
  })

  it("a video-only chunk maps no audio and says so (-an)", () => {
    const c = cmd({ omitAudio: true })
    expect(c.outputArgs).toContain("-an")
    expect(c.outputArgs.join(" ")).not.toContain("-c:a")
    expect(c.inputIds).toEqual(["A", "B"]) // the master is not an input
  })

  it("an audio slice for option B's pass is lossless PCM in RF64", () => {
    const c = cmd({ output: "audio", audioCodec: "pcm" })
    expect(c.outputArgs.join(" ")).toContain("-c:a pcm_f32le")
    expect(c.outputArgs.join(" ")).toContain("-rf64 auto")
  })
})

describe("sliceFingerprint — the resume key IS the command", () => {
  const V = "ffmpeg version n8.1.2"
  const fp = (c = cmd(), edl: Edl = EDL, v = V) => sliceFingerprint(c, edl, v)

  it("is stable for the same render (so a retry on a fresh workDir resumes)", () => {
    expect(fp(cmd())).toBe(fp(cmd()))
  })

  it("moves when the chunk's grid position changes its frame counts", () => {
    // 0.02 s later flips the first cut from 19 to 18 frames.
    expect(fp(cmd({ chunkStartSec: 0.02 }))).not.toBe(fp(cmd({ chunkStartSec: 0 })))
  })

  it("is SHARED by two positions that render byte-identically — the key is content, not bookkeeping", () => {
    // 0.5 s later happens to give every 0.617 s cut the same frame count, so the
    // command — and the output — is identical, and reusing it is correct.
    expect(cmd({ chunkStartSec: 0.5 }).filterGraph).toBe(cmd({ chunkStartSec: 0 }).filterGraph)
    expect(fp(cmd({ chunkStartSec: 0.5 }))).toBe(fp(cmd({ chunkStartSec: 0 })))
  })

  it("moves when the chunk covers different segments (a re-planned chunk)", () => {
    expect(fp(cmd({}, EDL.segments.slice(0, 3)))).not.toBe(fp(cmd({}, EDL.segments.slice(0, 4))))
  })

  it("moves when the chunk stops carrying audio (the option-B change itself)", () => {
    expect(fp(cmd({ omitAudio: true }))).not.toBe(fp(cmd({ omitAudio: false })))
  })

  it("moves with the canvas, the fps, the ffmpeg build and a source URL", () => {
    const base = fp()
    expect(fp(cmd({ target: { width: 640, height: 480 } }))).not.toBe(base)
    expect(fp(cmd({ fps: 25 }))).not.toBe(base)
    expect(fp(cmd(), EDL, "ffmpeg version n9.0")).not.toBe(base)
    const moved = { ...EDL, sources: EDL.sources.map((s) => (s.id === "A" ? { ...s, url: "https://f.test/other.mp4" } : s)) } as Edl
    expect(fp(cmd({}, EDL.segments, moved), moved)).not.toBe(base)
  })
})

describe("every chunk is held to its grid frame count at its END", () => {
  // 3 × 1 s segments, a 300 ms crossfade INTO the 2nd → 2.7 s of output.
  const segs = [
    { id: "x0", inMs: 0, outMs: 1000, video: "A" },
    { id: "x1", inMs: 1000, outMs: 2000, video: "B", transition: { type: "crossfade", durationMs: 300 } },
    { id: "x2", inMs: 2000, outMs: 3000, video: "A" },
  ] as unknown as EdlSegment[]
  const HOLD = (n: number) => `tpad=stop_mode=clone:stop=-1,trim=start_frame=0:end_frame=${n},setpts=round(N/FRAME_RATE/TB)[vout]`

  it("a crossfade chunk keeps exactly round((start+out)·F) − round(start·F) frames", () => {
    const c = cmd({ chunkStartSec: 10 }, segs)
    expect(c.filterGraph).toContain(`[vxf]${HOLD(Math.round((10 + 2.7) * 30) - Math.round(10 * 30))}`) // 81
  })

  it("a cut chunk ends with the same hold, sized to Σ of its segments' grid frames", () => {
    // six 617 ms cuts from 0: 19+18+19+18+19+18 = 111 = round(3.702·30)
    expect(cmd().filterGraph).toContain(`${HOLD(111)}`)
  })

  it("every picture read is taken from its source held past the end, every sound read from one padded with silence", () => {
    const g = cmd().filterGraph
    expect(g.match(/:V\]tpad=stop_mode=clone:stop=-1,trim=/g)).toHaveLength(6)
    expect(g.match(/:a\]apad,atrim=/g)).toHaveLength(6)
  })
})

describe("input seek — each source is read from its earliest window, not from t=0", () => {
  // The same six cuts, 100 s into every source.
  const late = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 100_000, outMs: s.outMs + 100_000 }))

  it("seeks each input to its earliest read minus the margin and rebases every trim on it", () => {
    const c = cmd({}, late)
    expect(c.inputSeekSec).toEqual([100 - INPUT_SEEK_MARGIN_SEC, 100 - INPUT_SEEK_MARGIN_SEC, 100.617 - INPUT_SEEK_MARGIN_SEC])
    expect(c.filterGraph).toContain(`[0:V]tpad=stop_mode=clone:stop=-1,trim=start=${INPUT_SEEK_MARGIN_SEC.toFixed(6)}:`)
    expect(c.filterGraph).toContain(`[1:a]apad,atrim=start=${INPUT_SEEK_MARGIN_SEC.toFixed(6)}:`)
  })

  it("does not seek a window within the margin of the source start", () => {
    expect(cmd().inputSeekSec).toEqual([0, 0, 0])
  })

  it("the key hashes the seek: two windows whose rebased graphs are identical still get different keys", () => {
    const at200 = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 200_000, outMs: s.outMs + 200_000 }))
    const a = cmd({}, late)
    const b = cmd({}, at200)
    expect(a.filterGraph).toBe(b.filterGraph)
    expect(sliceFingerprint(a, EDL, "v")).not.toBe(sliceFingerprint(b, EDL, "v"))
  })
})

/** Integer-exact PRNG (mulberry32): a float LCG overflows 2^53 and cycles in
 *  a few hundred draws, which would quietly shrink these sweeps. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("a crossfade chunk is frame-exact (Track 0.16)", () => {
  // Deterministic pseudo-random EDLs: every shape the validator admits (a
  // crossfade ≤ 0.9·min(adjacent)), slivers and one-frame segments included,
  // at integer and fractional rates, anywhere on the global timeline.
  const rnd = mulberry32(16)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!

  function randomChunk(): EdlSegment[] {
    const n = 2 + Math.floor(rnd() * 12)
    const lens = Array.from({ length: n }, () => pick([10, 20, 34, 40, 67, 120, 500, 1000, 2370]))
    return lens.map((len, i) => {
      const seg = { id: `r${i}`, inMs: 1000, outMs: 1000 + len, video: pick(["A", "B"]) } as EdlSegment
      if (i === 0 || rnd() < 0.4) return seg
      const maxD = Math.floor(0.9 * Math.min(len, lens[i - 1]!))
      return maxD >= 1 ? ({ ...seg, transition: { type: "crossfade", durationMs: 1 + Math.floor(rnd() * maxD) } } as EdlSegment) : seg
    })
  }

  it("the joined picture holds exactly the chunk's grid count, every xfade whole frames that fit its inputs", () => {
    let chunksWithXfade = 0
    for (let k = 0; k < 400; k++) {
      const segs = randomChunk()
      const fps = pick([24, 25, 29.97, 30, 59.94])
      const chunkStartSec = pick([0, 0.02, 10, 100.123, 3599.99])
      const g = cmd({ fps, chunkStartSec }, segs).filterGraph
      if (!g.includes("xfade=")) continue
      chunksWithXfade++
      const kept = new Map<string, number>()
      for (const m of g.matchAll(/trim=start_frame=(\d+):end_frame=(\d+),setpts=PTS-STARTPTS,format=yuv420p,setsar=1(\[v\d+\])/g)) {
        const [a, b] = [Number(m[1]), Number(m[2])]
        expect(b, g).toBeGreaterThan(a) // no empty label
        kept.set(m[3]!, b - a)
      }
      let blended = 0
      for (const m of g.matchAll(/\[[^\]]+\](\[v\d+\])xfade=transition=fade:duration=([\d.]+):offset=([\d.]+)/g)) {
        const d = Number(m[2]) * fps
        const off = Number(m[3]) * fps
        expect(Math.abs(d - Math.round(d)), `duration ${m[2]} @${fps}`).toBeLessThan(1e-3)
        expect(Math.abs(off - Math.round(off)), `offset ${m[3]} @${fps}`).toBeLessThan(1e-3)
        expect(Math.round(d)).toBeGreaterThanOrEqual(1)
        expect(Math.round(d)).toBeLessThan(kept.get(m[1]!)!) // the incoming side outlasts the blend
        blended += Math.round(d)
      }
      const total = [...kept.values()].reduce((a, b) => a + b, 0) - blended
      const outSec = segs.reduce((acc, s, i) => {
        const t = s.transition as { durationMs?: number } | undefined
        const ov = i > 0 && t ? Math.min(t.durationMs ?? 0, Math.floor(0.9 * Math.min(s.outMs - s.inMs, segs[i - 1]!.outMs - segs[i - 1]!.inMs))) : 0
        return acc + (s.outMs - s.inMs - ov) / 1000
      }, 0)
      const gridN = Math.max(1, Math.round((chunkStartSec + outSec) * fps) - Math.round(chunkStartSec * fps))
      expect(total, `${JSON.stringify(segs)} @${fps} start ${chunkStartSec}\n${g}`).toBe(gridN)
    }
    expect(chunksWithXfade).toBeGreaterThan(150) // the generator really exercises crossfades
  })
})

describe("a chunk's picture, its gridHold and the next chunk's start agree — even at an exact half-frame tie (Track 0.16)", () => {
  // Two float orders of the same sum round to opposite frames when the chunk's
  // end lands exactly on a half frame (e.g. 2.325 s × 60 = 139.5). The plan,
  // gridHold's count and the next chunk's first frame must all use ONE
  // arithmetic: `chunkOutputSec`, the value the render loop adds to
  // `chunkStartSec`. Durations here are multiples of 25/50 ms, which make such
  // ties common at 25/30/50/60 fps.
  const rnd = mulberry32(1600)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const endFrameOfHold = (g: string) => Number(/trim=start_frame=0:end_frame=(\d+),setpts=round\(N\/FRAME_RATE\/TB\)\[vout\]/.exec(g)![1])

  /** Σ kept label frames − Σ xfade frames: what the chain actually holds. */
  function chainFrames(g: string, fps: number): number {
    let kept = 0
    for (const m of g.matchAll(/fps=[\d.]+,trim=start_frame=0:end_frame=(\d+),setpts=PTS-STARTPTS,format=yuv420p,setsar=1\[v\d+\]/g)) kept += Number(m[1])
    let blended = 0
    for (const m of g.matchAll(/xfade=transition=fade:duration=([\d.]+):offset=/g)) blended += Math.round(Number(m[1]) * fps)
    return kept - blended
  }

  function tieChunk(xfade: boolean): EdlSegment[] {
    const n = 2 + Math.floor(rnd() * 6)
    const lens = Array.from({ length: n }, () => pick([25, 50, 75, 150, 825, 1000, 1550, 2150, 2275]))
    return lens.map((len, i) => {
      const seg = { id: `t${i}`, inMs: 0, outMs: len, video: pick(["A", "B"]) } as EdlSegment
      if (!xfade || i === 0 || rnd() < 0.3) return seg
      const maxD = Math.floor(0.9 * Math.min(len, lens[i - 1]!))
      const d = Math.floor((pick([25, 50, 100, 300, 850]) * maxD) / 850 / 25) * 25
      return d >= 25 ? ({ ...seg, transition: { type: "crossfade", durationMs: d } } as EdlSegment) : seg
    })
  }

  it("the reviewer's minimal repros: 825 + 1550 (xf 100) @60 from 0.05 s, and 2150 + 1000 (xf 850) @30 from 7200.05 s", () => {
    const cases: Array<{ segs: EdlSegment[]; fps: number; chunkStartSec: number }> = [
      { fps: 60, chunkStartSec: 0.05, segs: [
        { id: "a", inMs: 0, outMs: 825, video: "A" },
        { id: "b", inMs: 0, outMs: 1550, video: "B", transition: { type: "crossfade", durationMs: 100 } },
      ] as EdlSegment[] },
      { fps: 30, chunkStartSec: 7200.05, segs: [
        { id: "a", inMs: 0, outMs: 2150, video: "A" },
        { id: "b", inMs: 0, outMs: 1000, video: "B", transition: { type: "crossfade", durationMs: 850 } },
      ] as EdlSegment[] },
    ]
    for (const { segs, fps, chunkStartSec } of cases) {
      const g = cmd({ fps, chunkStartSec }, segs).filterGraph
      const nextStartF = Math.round((chunkStartSec + chunkOutputSec(segs)) * fps)
      expect(chainFrames(g, fps), g).toBe(endFrameOfHold(g))
      expect(endFrameOfHold(g), g).toBe(nextStartF - Math.round(chunkStartSec * fps))
    }
  })

  it("crossfade chunks: the chain holds exactly gridHold's count, which ends on the next chunk's first frame", () => {
    let ties = 0
    for (let k = 0; k < 2000; k++) {
      const segs = tieChunk(true)
      const fps = pick([25, 30, 50, 60, 29.97])
      const chunkStartSec = pick([0, 0.02, 0.05, 10, 7200.05])
      const g = cmd({ fps, chunkStartSec }, segs).filterGraph
      if (!g.includes("xfade=")) continue
      const outEnd = (chunkStartSec + chunkOutputSec(segs)) * fps
      if (Math.abs(outEnd - Math.floor(outEnd) - 0.5) < 1e-6) ties++
      expect(chainFrames(g, fps), `${JSON.stringify(segs)} @${fps} from ${chunkStartSec}`).toBe(endFrameOfHold(g))
      expect(endFrameOfHold(g)).toBe(Math.round(outEnd) - Math.round(chunkStartSec * fps))
    }
    expect(ties).toBeGreaterThan(20) // the generator really lands on exact half-frame ties
  })

  it("cut-only chunks: the grid's frames end on the next chunk's first frame (no seam drift at a tie)", () => {
    let ties = 0
    for (let k = 0; k < 2000; k++) {
      const segs = tieChunk(false)
      const fps = pick([25, 30, 50, 60, 29.97])
      const chunkStartSec = pick([0, 0.02, 0.05, 10, 7200.05])
      const g = cmd({ fps, chunkStartSec }, segs).filterGraph
      const outEnd = (chunkStartSec + chunkOutputSec(segs)) * fps
      if (Math.abs(outEnd - Math.floor(outEnd) - 0.5) < 1e-6) ties++
      const expected = Math.max(1, Math.round(outEnd) - Math.round(chunkStartSec * fps))
      expect(endFrameOfHold(g), `${JSON.stringify(segs)} @${fps} from ${chunkStartSec}`).toBe(expected)
    }
    expect(ties).toBeGreaterThan(20) // the generator really lands on exact half-frame ties
  })
})

describe("the encoder follows the render's quality, not its canvas size (A1)", () => {
  const encoder = (c: ReturnType<typeof cmd>) => {
    const a = c.outputArgs
    return { preset: a[a.indexOf("-preset") + 1], crf: a[a.indexOf("-crf") + 1] }
  }
  it("a FINAL render of a ≤720p canvas encodes at delivery quality — the old height rule gave it the proxy encoder", () => {
    expect(encoder(cmd({ quality: "final", target: { width: 1280, height: 720 } }))).toEqual({ preset: "fast", crf: "18" })
    expect(encoder(cmd({ quality: "final", target: { width: 320, height: 240 } }))).toEqual({ preset: "fast", crf: "18" })
  })
  it("a PROXY render encodes fast, whatever its canvas", () => {
    expect(encoder(cmd({ quality: "proxy", target: { width: 1280, height: 720 } }))).toEqual({ preset: "veryfast", crf: "26" })
    expect(encoder(cmd({ quality: "proxy", target: { width: 640, height: 360 } }))).toEqual({ preset: "veryfast", crf: "26" })
  })
  it("the resume key moves with the quality (a proxy chunk is never resumed into a final render)", () => {
    expect(sliceFingerprint(cmd({ quality: "proxy" }), EDL, "v")).not.toBe(sliceFingerprint(cmd({ quality: "final" }), EDL, "v"))
  })
})

// Plan B2 (review round 2 of #1630): a split head lying wholly inside the
// crossfade into it blends over all of its frames — the frames one pass blends —
// but only when its segment goes on: its tail (next chunk) holds a frame of its
// own. Otherwise one pass shows no picture of that segment at all, and neither
// may the split.
describe("a split head wholly inside its dissolve", () => {
  // At 30 fps: A holds frames [0, 30); the head starts at 0.964 s (frame 29),
  // ends at 1.004 s (frame 30) — its one frame is all dissolve.
  const head = (tailMs: number): PlanSegment => ({
    id: "h~1", inMs: 0, outMs: 40, video: "B", transition: { type: "crossfade", durationMs: 36 }, splitTailMs: tailMs,
  })
  const chunk = (tailMs: number) => [{ id: "a", inMs: 0, outMs: 1000, video: "A" } as PlanSegment, head(tailMs)]
  it("blends when its tail has a frame of its own", () => {
    expect(cmd({ omitAudio: true }, chunk(500)).filterGraph).toContain("xfade")
  })
  it("adds no picture when its tail rounds to no frame — as one pass shows none", () => {
    expect(cmd({ omitAudio: true }, chunk(5)).filterGraph).not.toContain("xfade")
  })
  it("a head that outlasts its dissolve blends either way (the ordinary split)", () => {
    const long: PlanSegment = { ...head(5), outMs: 200 }
    expect(cmd({ omitAudio: true }, [chunk(5)[0], long]).filterGraph).toContain("xfade")
  })
})
