// `buildSliceCommand` is pure: it decides EVERYTHING a slice renders (filter
// graph, encode arguments, input order) without touching the filesystem, so a
// chunk's resume key can be a hash of exactly that (`sliceFingerprint`). These
// pin the two properties the resume path depends on — the key moves whenever
// the render would, and never because of per-run local paths — and the
// crossfade chunk's end-of-chunk hold to the frame grid (Track 0.14).
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { aacArgs, buildSliceCommand, chunkOutputMs, frameAtMs, frameRateOf, sliceFingerprint, INPUT_SEEK_MARGIN_SEC, type PlanSegment, type SliceOptions } from "../apply-edl.js"

/** The grid frame of an integer-ms output position at `fps` (the one grid). */
const F = (ms: number, fps: number) => frameAtMs(ms, frameRateOf(fps))

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
  chunkStartMs: 0,
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
    // 20 ms later flips the first cut from 19 to 18 frames.
    expect(fp(cmd({ chunkStartMs: 20 }))).not.toBe(fp(cmd({ chunkStartMs: 0 })))
  })

  it("is SHARED by two positions that render byte-identically — the key is content, not bookkeeping", () => {
    // 500 ms later happens to give every 617 ms cut the same frame count, so the
    // command — and the output — is identical, and reusing it is correct.
    expect(cmd({ chunkStartMs: 500 }).filterGraph).toBe(cmd({ chunkStartMs: 0 }).filterGraph)
    expect(fp(cmd({ chunkStartMs: 500 }))).toBe(fp(cmd({ chunkStartMs: 0 })))
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
    const c = cmd({ chunkStartMs: 10_000 }, segs)
    expect(c.filterGraph).toContain(`[vxf]${HOLD(F(12_700, 30) - F(10_000, 30))}`) // 81
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
      const chunkStartMs = pick([0, 20, 10_000, 100_123, 3_599_990])
      const g = cmd({ fps, chunkStartMs }, segs).filterGraph
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
      const outMs = segs.reduce((acc, s, i) => {
        const t = s.transition as { durationMs?: number } | undefined
        const ov = i > 0 && t ? Math.min(t.durationMs ?? 0, Math.floor(0.9 * Math.min(s.outMs - s.inMs, segs[i - 1]!.outMs - segs[i - 1]!.inMs))) : 0
        return acc + (s.outMs - s.inMs - ov)
      }, 0)
      const gridN = Math.max(1, F(chunkStartMs + outMs, fps) - F(chunkStartMs, fps))
      expect(total, `${JSON.stringify(segs)} @${fps} start ${chunkStartMs}\n${g}`).toBe(gridN)
    }
    expect(chunksWithXfade).toBeGreaterThan(150) // the generator really exercises crossfades
  })
})

describe("a chunk's picture, its gridHold and the next chunk's start agree — even at an exact half-frame tie (Track 0.16)", () => {
  // Two float orders of the same sum round to opposite frames when the chunk's
  // end lands exactly on a half frame (e.g. 2.325 s × 60 = 139.5). The plan,
  // gridHold's count and the next chunk's first frame must all use ONE
  // arithmetic: `frameAtMs` of the integer-ms position (`chunkOutputMs`, the
  // value the render loop adds to `chunkStartMs`). Durations here are multiples
  // of 25/50 ms, which make such ties common at 25/30/50/60 fps.
  const rnd = mulberry32(1600)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  /** Does `ms` sit exactly on a half frame at `fps`? (2·ms·num / (den·1000) odd.) */
  const isTie = (ms: number, fps: number) => {
    const { num, den } = frameRateOf(fps)
    const twice = 2 * ms * num
    return twice % (den * 1000) === 0 && (twice / (den * 1000)) % 2 === 1
  }
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
    const cases: Array<{ segs: EdlSegment[]; fps: number; chunkStartMs: number }> = [
      { fps: 60, chunkStartMs: 50, segs: [
        { id: "a", inMs: 0, outMs: 825, video: "A" },
        { id: "b", inMs: 0, outMs: 1550, video: "B", transition: { type: "crossfade", durationMs: 100 } },
      ] as EdlSegment[] },
      { fps: 30, chunkStartMs: 7_200_050, segs: [
        { id: "a", inMs: 0, outMs: 2150, video: "A" },
        { id: "b", inMs: 0, outMs: 1000, video: "B", transition: { type: "crossfade", durationMs: 850 } },
      ] as EdlSegment[] },
    ]
    for (const { segs, fps, chunkStartMs } of cases) {
      const g = cmd({ fps, chunkStartMs }, segs).filterGraph
      const nextStartF = F(chunkStartMs + chunkOutputMs(segs), fps)
      expect(chainFrames(g, fps), g).toBe(endFrameOfHold(g))
      expect(endFrameOfHold(g), g).toBe(nextStartF - F(chunkStartMs, fps))
    }
  })

  it("crossfade chunks: the chain holds exactly gridHold's count, which ends on the next chunk's first frame", () => {
    let ties = 0
    for (let k = 0; k < 2000; k++) {
      const segs = tieChunk(true)
      const fps = pick([25, 30, 50, 60, 29.97])
      const chunkStartMs = pick([0, 20, 50, 10_000, 7_200_050])
      const g = cmd({ fps, chunkStartMs }, segs).filterGraph
      if (!g.includes("xfade=")) continue
      const endMs = chunkStartMs + chunkOutputMs(segs)
      if (isTie(endMs, fps)) ties++
      expect(chainFrames(g, fps), `${JSON.stringify(segs)} @${fps} from ${chunkStartMs}`).toBe(endFrameOfHold(g))
      expect(endFrameOfHold(g)).toBe(F(endMs, fps) - F(chunkStartMs, fps))
    }
    expect(ties).toBeGreaterThan(20) // the generator really lands on exact half-frame ties
  })

  it("cut-only chunks: the grid's frames end on the next chunk's first frame (no seam drift at a tie)", () => {
    let ties = 0
    for (let k = 0; k < 2000; k++) {
      const segs = tieChunk(false)
      const fps = pick([25, 30, 50, 60, 29.97])
      const chunkStartMs = pick([0, 20, 50, 10_000, 7_200_050])
      const g = cmd({ fps, chunkStartMs }, segs).filterGraph
      const endMs = chunkStartMs + chunkOutputMs(segs)
      if (isTie(endMs, fps)) ties++
      const expected = Math.max(1, F(endMs, fps) - F(chunkStartMs, fps))
      expect(endFrameOfHold(g), `${JSON.stringify(segs)} @${fps} from ${chunkStartMs}`).toBe(expected)
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

// A1c (TA7, decided 2026-10-04): a proxy's sound is lighter MONO — AAC at
// 96 kbps, still at 48 kHz, so it keeps the final's timing sample for sample.
// The mono mix is the AVERAGE of the final's two channels, made in the graph:
// the encoder's own stereo→mono law would play every preview 3 dB louder than
// its final (a player sends a mono file to both speakers at full level) and
// could clip a hot source the final does not. Real-ffmpeg proof of all four
// AAC encodes: `apply-edl-proxy-audio.e2e.test.ts`.
describe("a proxy's sound is lighter mono at the final's 48 kHz (A1c)", () => {
  const FINAL_AAC = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
  const PROXY_AAC = ["-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "1"]
  const DOWNMIX = "pan=mono|c0=0.5*FL+0.5*FR"

  it("one AAC encode per quality: the final's unchanged, the proxy's mono 96 kbps at 48 kHz", () => {
    expect(aacArgs("final")).toEqual(FINAL_AAC)
    expect(aacArgs("proxy")).toEqual(PROXY_AAC)
  })

  it("a final slice keeps its delivery encode byte for byte, with no downmix in its graph", () => {
    expect(cmd({ quality: "final" }).outputArgs).toEqual([
      "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
      ...FINAL_AAC, "-movflags", "+faststart",
    ])
    expect(cmd({ quality: "final", output: "audio" }).outputArgs).toEqual(["-map", "[aout]", ...FINAL_AAC])
    expect(cmd({ quality: "final", output: "audio", audioCodec: "pcm" }).outputArgs)
      .toEqual(["-map", "[aout]", "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "2", "-rf64", "auto"])
    for (const output of ["video", "audio"] as const) expect(cmd({ quality: "final", output }).filterGraph).not.toContain("pan=")
  })

  it("a proxy slice, video or audio, maps the averaged mono mix and encodes it lighter", () => {
    for (const output of ["video", "audio"] as const) {
      const c = cmd({ quality: "proxy", output })
      expect(c.filterGraph).toContain(`[aout]${DOWNMIX}[amono]`)
      const args = c.outputArgs.join(" ")
      expect(args).toContain("-map [amono]")
      expect(args).not.toContain("-map [aout]")
      expect(args).toContain(PROXY_AAC.join(" "))
      expect(args).not.toContain("192k")
    }
  })

  it("a one-segment proxy downmixes its only segment", () => {
    expect(cmd({ quality: "proxy", output: "audio" }, EDL.segments.slice(0, 1)).filterGraph).toContain(`[a0]${DOWNMIX}[amono]`)
  })

  it("a proxy's lossless slice is mono, so the join and the mux encode exactly what the graph mixed", () => {
    expect(cmd({ quality: "proxy", output: "audio", audioCodec: "pcm" }).outputArgs)
      .toEqual(["-map", "[amono]", "-c:a", "pcm_f32le", "-ar", "48000", "-ac", "1", "-rf64", "auto"])
  })

  it("a picture-only proxy chunk carries no sound, so it has nothing to downmix", () => {
    const c = cmd({ quality: "proxy", omitAudio: true })
    expect(c.filterGraph).not.toContain("pan=")
    expect(c.outputArgs).toContain("-an")
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

// Track 0.18, fix F5 (decided 2026-10-06): a source whose sound is not at 48 kHz
// is resampled sample-exactly. `atrim` on a 44.1 kHz stream rounds every cut to
// its own sample grid and the resampler's output length rounds again, so an
// unseeked graph lost ~0.7 samples per segment (−20 by segment 30) and a seek
// off a whole second shifted every segment by a constant fraction of a sample.
// F5: the input is seeked to a WHOLE second (an exact sample at any integer
// rate), each segment is cut coarsely from a whole second ≥ 1 s before it (also
// exact, and a lead-in for the resampler), resampled to 48 kHz, and then cut
// EXACTLY at 48 kHz in samples — `end − start = dur·48` for every segment.
describe("a non-48 kHz sound source is resampled sample-exactly (Track 0.18, F5)", () => {
  const RATES = (r: number) => ({ audioSampleRate: new Map([["A", r], ["B", r], ["MIC", r]]) })
  // The six 617 ms cuts at an odd position (off the 10 ms grid and off a second).
  const odd = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 100_623, outMs: s.outMs + 100_623 }))
  const late = EDL.segments.map((s) => ({ ...s, inMs: s.inMs + 100_000, outMs: s.outMs + 100_000 }))
  const xf = [
    { id: "x0", inMs: 0, outMs: 1000, video: "A" },
    { id: "x1", inMs: 1000, outMs: 2000, video: "B", transition: { type: "crossfade", durationMs: 300 } },
    { id: "x2", inMs: 2000, outMs: 3000, video: "A" },
  ] as unknown as EdlSegment[]
  const SHAPES: Array<[string, Partial<SliceOptions>, readonly EdlSegment[]]> = [
    ["a cut chunk from 0", {}, EDL.segments],
    ["a seeked chunk", {}, late],
    ["a chunk at an odd ms", {}, odd],
    ["a crossfade chunk", {}, xf],
    ["a lossless audio slice", { output: "audio", audioCodec: "pcm" }, odd],
    ["a proxy audio render", { output: "audio", quality: "proxy" }, odd],
    ["a picture-only chunk", { omitAudio: true }, odd],
  ]

  for (const [name, over, segs] of SHAPES) {
    it(`48 kHz, or a rate never measured, renders exactly the command it always did: ${name}`, () => {
      const today = cmd(over, segs)
      expect(cmd({ ...over, ...RATES(48_000) }, segs)).toEqual(today)
      expect(cmd({ ...over, audioSampleRate: new Map() }, segs)).toEqual(today)
      expect(sliceFingerprint(cmd({ ...over, ...RATES(48_000) }, segs), EDL, "v")).toBe(sliceFingerprint(today, EDL, "v"))
    })
  }

  it("a picture-only chunk reads no sound, so a 44.1 kHz camera keeps its command and its resume key", () => {
    const today = cmd({ omitAudio: true }, odd)
    expect(cmd({ omitAudio: true, ...RATES(44_100) }, odd)).toEqual(today)
    expect(sliceFingerprint(cmd({ omitAudio: true, ...RATES(44_100) }, odd), EDL, "v")).toBe(sliceFingerprint(today, EDL, "v"))
  })

  it("seeks a 44.1 kHz input to a whole second and cuts it at exact 48 kHz samples", () => {
    const c = cmd({ audioSampleRate: new Map([["MIC", 44_100]]) }, odd)
    // A and B keep their ms seek (no sound is read from them); the master's
    // earliest read is 100.623 s → a whole-second seek at 98 s, not 98.623.
    expect(c.inputIds).toEqual(["A", "MIC", "B"])
    expect(c.inputSeekSec).toEqual([100.623 - INPUT_SEEK_MARGIN_SEC, 98, 101.24 - INPUT_SEEK_MARGIN_SEC])
    // Segment 0 reads [2.623, 3.240) after the seek: coarse cut [1 s, 5 s) — a
    // whole second of lead-in and lead-out — then [(2.623 − 1)·48000,
    // + 0.617·48000) at 48 kHz.
    expect(c.filterGraph).toContain(
      "[1:a]apad,atrim=start=1:end=5,asetpts=PTS-1/TB,aresample=48000:first_pts=0:min_comp=0,apad," +
        "atrim=start_sample=77904:end_sample=107520,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a0]",
    )
    expect(c.filterGraph.match(/aresample=48000/g)).toHaveLength(6)
  })

  it("an unseeked input is cut from its own whole seconds (never before 0)", () => {
    const c = cmd({ output: "audio", audioCodec: "pcm", audioSampleRate: new Map([["MIC", 44_100]]) })
    expect(c.inputSeekSec).toEqual([0])
    // Segment 0 is [0, 0.617) → coarse [0, 2); segment 2 is [1.234, 1.851) → [0, 3).
    expect(c.filterGraph).toContain("[0:a]apad,atrim=start=0:end=2,asetpts=PTS-0/TB,aresample=48000:first_pts=0:min_comp=0,apad,atrim=start_sample=0:end_sample=29616,")
    expect(c.filterGraph).toContain("atrim=start=0:end=3,asetpts=PTS-0/TB,aresample=48000:first_pts=0:min_comp=0,apad,atrim=start_sample=59232:end_sample=88848,")
  })

  it("a camera's own 44.1 kHz sound moves its picture reads onto the same whole-second seek", () => {
    const own: Edl = { ...EDL, sources: EDL.sources.filter((s) => s.id !== "MIC") } as Edl
    const c = buildSliceCommand(own, odd, { ...OPTS, masterAudioId: undefined, audioSampleRate: new Map([["A", 44_100]]) })
    expect(c.inputIds).toEqual(["A", "B"])
    expect(c.inputSeekSec).toEqual([98, 101.24 - INPUT_SEEK_MARGIN_SEC])
    // A's first picture read rebases on 98 s: 100.623 − 98.
    expect(c.filterGraph).toContain("[0:V]tpad=stop_mode=clone:stop=-1,trim=start=2.623000:")
    expect(c.filterGraph).toContain("[0:a]apad,atrim=start=1:end=5,asetpts=PTS-1/TB,aresample=48000:first_pts=0:min_comp=0,")
    // B (48 kHz, unmeasured here) is untouched.
    expect(c.filterGraph).toContain("[1:a]apad,atrim=start=2.000000:end=2.617000,asetpts=PTS-STARTPTS,aformat=")
  })

  it("every segment is exactly dur·48 samples at any integer rate, wherever it sits", () => {
    const rnd = mulberry32(4410)
    for (const rate of [8_000, 11_025, 22_050, 32_000, 44_100, 88_200, 96_000]) {
      for (let trial = 0; trial < 40; trial++) {
        let t = Math.floor(rnd() * 3_600_000)
        const segs = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, k) => {
          const len = 1 + Math.floor(rnd() * 5000)
          const seg = { id: `q${k}`, inMs: t, outMs: t + len } as EdlSegment
          t += len + Math.floor(rnd() * 3000)
          return seg
        })
        const c = cmd({ output: "audio", audioCodec: "pcm", audioSampleRate: new Map([["MIC", rate]]) }, segs)
        const seek = c.inputSeekSec[0]!
        expect(Number.isInteger(seek)).toBe(true)
        const cuts = [...c.filterGraph.matchAll(/atrim=start=(\d+):end=(\d+),asetpts=PTS-(\d+)\/TB,aresample=48000:first_pts=0:min_comp=0,apad,atrim=start_sample=(\d+):end_sample=(\d+),/g)]
        expect(cuts).toHaveLength(segs.length)
        cuts.forEach((m, k) => {
          const coarse = Number(m[1]), coarseEnd = Number(m[2]), s = Number(m[4]), e = Number(m[5])
          // Rebased on the WHOLE second the cut starts at, never on its first
          // packet: a sound that starts after it is padded, not pulled early.
          expect(Number(m[3])).toBe(coarse)
          const startMs = segs[k]!.inMs - seek * 1000
          const endMs = segs[k]!.outMs - seek * 1000
          expect(coarseEnd).toBe(Math.ceil(endMs / 1000) + 1)
          expect(e - s).toBe((segs[k]!.outMs - segs[k]!.inMs) * 48)
          expect(s).toBe((startMs - coarse * 1000) * 48)
          expect(coarse).toBe(Math.max(0, Math.floor(startMs / 1000) - 1))
        })
      }
    }
  })

  it("the resume key moves for a slice whose sound is resampled, and only for it", () => {
    const a = cmd({ output: "audio", audioCodec: "pcm" }, odd)
    const b = cmd({ output: "audio", audioCodec: "pcm", audioSampleRate: new Map([["MIC", 44_100]]) }, odd)
    expect(sliceFingerprint(b, EDL, "v")).not.toBe(sliceFingerprint(a, EDL, "v"))
  })
})
