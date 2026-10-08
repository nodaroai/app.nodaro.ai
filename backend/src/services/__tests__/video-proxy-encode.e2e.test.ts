/**
 * Real-ffmpeg fixtures for the detection proxy (P3.2): the span map must put
 * every proxy frame back on the source clock, because the detector returns a
 * frame index and nothing else.
 *
 * The sources carry a burnt-in frame counter: twelve columns, each white or
 * black for one bit of the generator's frame number N. Its true source time is
 * N × 1001/30000 s (the generator runs at 29.97 fps and `select` keeps each
 * frame's own timestamp, so the VFR source keeps them too). Reading the counter
 * back off a proxy frame says which source frame it shows; the span map says
 * which source time it claims to show. They must agree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { encodeVideoProxy, MediaHasNoVideoError } from "../video-proxy-encode.js"
import { proxyFrameToSourceMs, type ProxySpan, type ProxySpanMap } from "../media-proxy-span-map.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

const run = promisify(execFile)

const SRC_FRAME_MS = 1001 / 30
const BITS = 12
const COUNTER = `geq=lum='if(mod(floor(N/pow(2,floor(X/32))),2),235,16)':cb=128:cr=128`
const counterSource = (seconds: number) => `nullsrc=s=384x216:r=30000/1001:d=${seconds},${COUNTER}`

/** The counter on every frame of `file`, in presentation order. */
async function readCounters(file: string, width: number): Promise<number[]> {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-i", file, "-vf", "format=gray,crop=iw:1:0:ih/2", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  )
  const col = width / BITS
  const out: number[] = []
  for (let f = 0; f < stdout.length / width; f++) {
    let n = 0
    for (let k = 0; k < BITS; k++) if (stdout[f * width + Math.floor(k * col + col / 2)] > 128) n |= 1 << k
    out.push(n)
  }
  return out
}

/** Presentation times (ms) of a file's video frames, sorted. */
async function framePtsMs(file: string): Promise<number[]> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file])
  return out.split("\n").map((l) => Number.parseFloat(l)).filter(Number.isFinite).map((s) => s * 1000).sort((a, b) => a - b)
}

/** The source's frame times on the clock ffmpeg cuts on: rebased to the
 *  container's start (an MPEG-TS file starts at ~1.4 s, not 0). */
async function sourceClockPtsMs(file: string): Promise<number[]> {
  const start = Number.parseFloat(await runFfprobe(["-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", file]))
  const startMs = Number.isFinite(start) ? start * 1000 : 0
  return (await framePtsMs(file)).map((ms) => ms - startMs)
}

/** Index (into `sourcePts`) of the source frame on screen at `ms`: the last
 *  one that started at or before it; -1 when no frame has started yet. */
const onScreenAt = (sourcePts: readonly number[], ms: number): number => {
  let shown = -1
  sourcePts.forEach((p, i) => { if (p <= ms + 0.001) shown = i })
  return shown
}

/**
 * Every proxy frame shows the source frame on screen at the time the span map
 * gives it, or the one right after it when that one starts within one sample
 * period (a seek lands on the first frame at or after its point) — the P3-16
 * clock bar, "each marker maps to source ms within one sample period", stated
 * on the source's own frames: a VFR hole is held to the frame before it, and
 * the slack never stretches across a hole.
 *
 * `counterZeroMs`: source time of the counter's frame 0 (a video stream that
 * starts after the container's zero starts its counter there).
 */
async function expectClockHolds(proxy: string, map: ProxySpanMap, fps: number, sourcePts: readonly number[], counterZeroMs = 0) {
  const periodMs = 1000 / fps
  const counters = await readCounters(proxy, (await dims(proxy)).width)
  expect(counters.length).toBe(map.reduce((a, r) => a + r.frameCount, 0))
  counters.forEach((n, frame) => {
    const mapped = proxyFrameToSourceMs(map, fps, frame)
    expect(mapped, `frame ${frame}`).toBeDefined()
    const shownMs = counterZeroMs + n * SRC_FRAME_MS
    const at = onScreenAt(sourcePts, mapped!)
    expect(at, `frame ${frame}: mapped ${mapped}, before the source's first picture (${sourcePts[0]}), shows ${shownMs}`).toBeGreaterThanOrEqual(0)
    const lo = sourcePts[at] - 1
    const hi = Math.max(sourcePts[at], Math.min(sourcePts[at + 1] ?? sourcePts[at], mapped! + periodMs)) + 1
    expect(shownMs >= lo && shownMs <= hi, `frame ${frame}: shows ${shownMs}, mapped ${mapped} (on screen ${sourcePts[at]})`).toBe(true)
  })
}

/**
 * Each row stays inside the span it came from — the output is clipped to the
 * span, not just the read — so rows never overlap on the source clock and the
 * proxy holds no more than Σ⌈span × fps⌉ frames. And the joined proxy's own
 * times run strictly forward.
 */
async function expectRowsBounded(proxy: string, map: ProxySpanMap, fps: number, spans: readonly ProxySpan[]) {
  const periodMs = 1000 / fps
  expect(map).toHaveLength(spans.length)
  map.forEach((row, i) => {
    const span = spans[i]
    expect(row.sourceStartMs, `row ${i}`).toBeGreaterThanOrEqual(span.startMs - 0.001)
    expect(row.sourceStartMs + row.frameCount * periodMs, `row ${i}: ${row.frameCount} frames from ${row.sourceStartMs}`).toBeLessThanOrEqual(span.endMs + periodMs + 0.001)
    expect(row.frameCount, `row ${i}`).toBeLessThanOrEqual(Math.ceil(((span.endMs - span.startMs) * fps) / 1000))
    if (i > 0) {
      const prev = map[i - 1]
      expect(prev.sourceStartMs + (prev.frameCount - 1) * periodMs, `rows ${i - 1} and ${i} overlap`).toBeLessThan(row.sourceStartMs)
    }
  })
  const pts = await framePtsMs(proxy)
  pts.forEach((p, i) => { if (i > 0) expect(p, `proxy frame ${i}`).toBeGreaterThan(pts[i - 1]) })
}

async function dims(file: string): Promise<{ width: number; height: number; sar: string; rotation: string }> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,sample_aspect_ratio:stream_side_data=rotation", "-of", "json", file])
  const s = JSON.parse(out).streams[0]
  return { width: s.width, height: s.height, sar: s.sample_aspect_ratio ?? "1:1", rotation: String(s.side_data_list?.[0]?.rotation ?? "") }
}

describe("encodeVideoProxy (e2e, real ffmpeg)", () => {
  let dir: string
  const p = (name: string) => join(dir, name)
  const work = async (name: string) => { const d = p(name); await fs.mkdir(d); return d }

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "video-proxy-e2e-"))
    const x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p"]
    // 60 s at 29.97 fps, a keyframe every 2 s (so every seek decodes from a keyframe behind it).
    await runFfmpeg(["-y", "-f", "lavfi", "-i", counterSource(60), ...x264, "-g", "60", p("cfr.mp4")])
    // VFR: a 2 s hole (frames 100–160) and every 7th frame missing.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", `${counterSource(30)},select='not(between(n\\,100\\,160))*not(eq(mod(n\\,7)\\,3))'`,
      "-fps_mode", "vfr", ...x264, p("vfr.mp4"),
    ])
    // Rotated: stored landscape, displayed portrait.
    await runFfmpeg(["-y", "-display_rotation", "90", "-i", p("cfr.mp4"), "-c", "copy", p("rotated.mp4")])
    // Anamorphic: 384×216 stored, 2:1 pixels → 768×216 displayed.
    await runFfmpeg(["-y", "-i", p("cfr.mp4"), "-t", "5", "-vf", "setsar=2", ...x264, p("anamorphic.mp4")])
    // MPEG-TS (a camera's .mts, an OBS .ts): starts at ~1.4 s, and an input
    // seek can land on a keyframe well AFTER its point.
    await runFfmpeg(["-y", "-i", p("cfr.mp4"), "-t", "20", "-c", "copy", p("cfr.ts")])
    // A video stream that starts 0.667 s after the container's zero (audio at 0).
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", counterSource(6), "-f", "lavfi", "-i", "sine=d=6",
      "-filter_complex", "[0:v]setpts=PTS+0.667/TB[v]", "-map", "[v]", "-map", "1:a", ...x264, "-c:a", "aac", p("late.mp4"),
    ])
    // Audio only.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=d=2", p("audio.m4a")])
    // Scene cuts (P3.2b). A pre-edited source: three different pictures, hard
    // cuts at source frames 120 and 210 (4.004 s and 7.007 s at 29.97 fps),
    // each picture moving or still the way a camera's is.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i",
      `testsrc2=s=384x216:r=30000/1001:d=4[a];smptehdbars=s=384x216:r=30000/1001:d=3[b];testsrc=s=384x216:r=30000/1001:d=5[c];[a][b][c]concat=n=3:v=1`,
      ...x264, "-g", "60", p("cuts.mp4"),
    ])
    // Two hard cuts 300 ms apart (a quick reaction insert): testsrc2 for 2 s,
    // SMPTE bars for 0.3 s, then a mandelbrot. Closer together than the rule's
    // window, so each cut's nearest neighbour is the other cut.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i",
      `testsrc2=s=384x216:r=30000/1001:d=2[a];smptebars=s=384x216:r=30000/1001:d=0.3[b];mandelbrot=s=384x216:r=30000/1001,trim=duration=2[c];[a][b][c]concat=n=3:v=1`,
      ...x264, "-g", "60", p("cuts-close.mp4"),
    ])
    // A one-second dissolve between two pictures, from 3 s to 4 s (catie's
    // opening is one): gradual, so a decode-rate jump detector may miss it.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i",
      `testsrc2=s=384x216:r=30000/1001:d=5[a];smptehdbars=s=384x216:r=30000/1001:d=5[b];[a][b]xfade=transition=fade:duration=1:offset=3`,
      ...x264, p("dissolve.mp4"),
    ])
    // A static shot with camera grain: no cut anywhere.
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x506070:s=384x216:r=30000/1001:d=10,noise=alls=12:allf=t+u", ...x264, p("grain.mp4")])
    // A handheld shake: a window jumping up to 40 px at random every frame
    // over a textured picture. Its scdet scores sit at 5–18 on frame after
    // frame (a plateau), well over the threshold — never a spike.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i",
      "nullsrc=s=1400x216:r=30000/1001:d=4,geq=lum='128+60*sin(X/7)*cos(Y/5)+40*sin(X/23)':cb=128:cr=128,crop=384:216:'600+40*random(1)':0",
      ...x264, p("shake.mp4"),
    ])
    // A camera flash: one all-white frame (source frame 60) inside a shot, the
    // picture before it coming straight back.
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc2=s=384x216:r=30000/1001:d=4,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,60)'",
      ...x264, p("flash.mp4"),
    ])
    // Flashes held for two and for three frames (source frames 60–61, 60–62):
    // the picture before each comes back after it.
    for (const held of [2, 3]) {
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", `testsrc2=s=384x216:r=30000/1001:d=4,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(n,60,${59 + held})'`,
        ...x264, p(`flash-${held}.mp4`),
      ])
    }
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  for (const fps of [2, 2.5]) {
    it(`multi-span at ${fps} fps: every frame, including both sides of every join, maps to the source frame it shows`, async () => {
      const spans = [{ startMs: 0, endMs: 3300 }, { startMs: 10_300, endMs: 14_900 }, { startMs: 40_777, endMs: 47_877 }]
      const r = await encodeVideoProxy(p("cfr.mp4"), await work(`multi-${fps}`), { fps, height: 108, spans })
      expect(r.spanMap).toHaveLength(3)
      // A span whose start falls between source frames samples from the next
      // grid point after its first decoded frame: no earlier sample is made up.
      expect(r.spanMap.map((row) => Math.round(row.sourceStartMs))).toEqual([0, 10_300 + 1000 / fps, 40_777 + 1000 / fps])
      // rows tile the proxy, frame for frame
      r.spanMap.forEach((row, i) => {
        if (i > 0) expect(row.firstFrame).toBe(r.spanMap[i - 1].firstFrame + r.spanMap[i - 1].frameCount)
      })
      expect(r.frameCount).toBe((await framePtsMs(r.outPath)).length)
      await expectClockHolds(r.outPath, r.spanMap, fps, await framePtsMs(p("cfr.mp4")))
      await expectRowsBounded(r.outPath, r.spanMap, fps, spans)
    }, 120_000)
  }

  it("a VFR source: frames inside a hole show the last frame before it, at the time the map says", async () => {
    const spans = [{ startMs: 2900, endMs: 6900 }, { startMs: 20_000, endMs: 23_000 }]
    const r = await encodeVideoProxy(p("vfr.mp4"), await work("vfr"), { fps: 2, height: 108, spans })
    await expectClockHolds(r.outPath, r.spanMap, 2, await framePtsMs(p("vfr.mp4")))
    await expectRowsBounded(r.outPath, r.spanMap, 2, spans)
  }, 120_000)

  it("a span starting INSIDE a VFR hole: no frame before the first decoded one is back-filled with it", async () => {
    const spans = [{ startMs: 3500, endMs: 7000 }]
    const r = await encodeVideoProxy(p("vfr.mp4"), await work("vfr-in-hole"), { fps: 2, height: 108, spans })
    await expectClockHolds(r.outPath, r.spanMap, 2, await framePtsMs(p("vfr.mp4")))
    await expectRowsBounded(r.outPath, r.spanMap, 2, spans)
  }, 120_000)

  it("a span ending just before a VFR hole: the held last frame is not written past the span's end", async () => {
    const spans = [{ startMs: 3000, endMs: 3350 }, { startMs: 4800, endMs: 5600 }]
    const r = await encodeVideoProxy(p("vfr.mp4"), await work("vfr-before-hole"), { fps: 7.5, height: 108, spans })
    await expectClockHolds(r.outPath, r.spanMap, 7.5, await framePtsMs(p("vfr.mp4")))
    await expectRowsBounded(r.outPath, r.spanMap, 7.5, spans)
  }, 120_000)

  it("an MPEG-TS source whose seek lands late: the map starts at the first frame decoded, and stops at the span's end", async () => {
    const spans = [{ startMs: 5000, endMs: 7000 }, { startMs: 12_000, endMs: 14_000 }]
    const r = await encodeVideoProxy(p("cfr.ts"), await work("ts"), { fps: 2, height: 108, spans })
    await expectClockHolds(r.outPath, r.spanMap, 2, await sourceClockPtsMs(p("cfr.ts")))
    await expectRowsBounded(r.outPath, r.spanMap, 2, spans)
  }, 120_000)

  it("a whole source whose picture starts after the container's zero: no sample before the first picture", async () => {
    const r = await encodeVideoProxy(p("late.mp4"), await work("late"), { fps: 2, height: 108 })
    const sourcePts = await sourceClockPtsMs(p("late.mp4"))
    expect(sourcePts[0]).toBeGreaterThan(500)
    expect(r.spanMap[0].sourceStartMs).toBeGreaterThanOrEqual(sourcePts[0])
    await expectClockHolds(r.outPath, r.spanMap, 2, sourcePts, sourcePts[0])
  }, 120_000)

  it("no spans: the whole source, one row from zero", async () => {
    const r = await encodeVideoProxy(p("anamorphic.mp4"), await work("whole"), { fps: 2, height: 108 })
    expect(r.spanMap).toHaveLength(1)
    expect(r.spanMap[0]).toMatchObject({ sourceStartMs: 0, proxyStartMs: 0, firstFrame: 0 })
    // 150 frames at 29.97 fps = 5.005 s: samples at 0, 0.5 … 5.0 s
    expect(r.frameCount).toBe(11)
  }, 120_000)

  it("a rotated source comes out display-oriented with square pixels and no rotation left to apply", async () => {
    const r = await encodeVideoProxy(p("rotated.mp4"), await work("rotated"), { fps: 2, height: 192, spans: [{ startMs: 1000, endMs: 3000 }] })
    const d = await dims(r.outPath)
    expect(d.height).toBe(192)
    expect(d.width).toBe(108)
    expect(d.sar).toBe("1:1")
    expect(d.rotation).toBe("")
    expect(r.frame).toEqual({ w: 108, h: 192 })
  }, 120_000)

  it("non-square pixels come out square at the display aspect", async () => {
    const r = await encodeVideoProxy(p("anamorphic.mp4"), await work("anamorphic"), { fps: 2, height: 108, spans: [{ startMs: 0, endMs: 2000 }] })
    expect(r.frame).toEqual({ w: 384, h: 108 })
    expect((await dims(r.outPath)).sar).toBe("1:1")
  }, 120_000)

  it("never upscales: a source shorter than the asked height keeps its own", async () => {
    const r = await encodeVideoProxy(p("cfr.mp4"), await work("no-upscale"), { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 1000 }] })
    expect(r.frame).toEqual({ w: 384, h: 216 })
  }, 120_000)

  it("a span running past the picture's end stops at it, one wholly past it adds no row; all past it is a deterministic error", async () => {
    const r = await encodeVideoProxy(p("anamorphic.mp4"), await work("past-end"), {
      fps: 2, height: 108, spans: [{ startMs: 1000, endMs: 2000 }, { startMs: 4000, endMs: 9000 }, { startMs: 20_000, endMs: 30_000 }],
    })
    expect(r.spanMap).toHaveLength(2)
    const last = r.spanMap[1]
    expect(last.sourceStartMs + (last.frameCount * 1000) / 2).toBeLessThanOrEqual(5500)
    const err = await encodeVideoProxy(p("anamorphic.mp4"), await work("all-past-end"), { fps: 2, height: 108, spans: [{ startMs: 20_000, endMs: 30_000 }] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeterministicJobError)
  }, 120_000)

  describe("scene cuts in the same decode (P3.2b)", () => {
    /** Source frame N's time on the source clock (ms). */
    const frameMs = (n: number) => n * SRC_FRAME_MS
    /** A cut lands ON the first frame of the new shot: within a ms of its pts. */
    const expectCutsAt = (cuts: readonly number[], frames: readonly number[]) => {
      expect(cuts).toHaveLength(frames.length)
      cuts.forEach((c, i) => expect(Math.abs(c - frameMs(frames[i])), `cut ${i} at ${c} ms, frame ${frames[i]} at ${frameMs(frames[i])}`).toBeLessThan(1))
    }

    // Exactly two cuts: the moving test pictures between them (testsrc2's
    // drifting shapes, testsrc's sweep) are motion, not edits.
    it("a whole pre-edited source: every hard cut, on the source clock, at the first frame of the new shot", async () => {
      const r = await encodeVideoProxy(p("cuts.mp4"), await work("cuts-whole"), { fps: 2, height: 108 })
      expectCutsAt(r.cuts, [120, 210])
    }, 120_000)

    it("span-scoped: each span's cuts come back on the SOURCE clock, not the proxy's or the span's", async () => {
      const spans = [{ startMs: 3000, endMs: 5000 }, { startMs: 6100, endMs: 9000 }]
      const r = await encodeVideoProxy(p("cuts.mp4"), await work("cuts-spans"), { fps: 2, height: 108, spans })
      expectCutsAt(r.cuts, [120, 210])
      // and each cut falls between the two proxy samples either side of it
      for (const c of r.cuts) {
        const rowIdx = r.spanMap.findIndex((row) => c >= row.sourceStartMs && c < row.sourceStartMs + (row.frameCount * 1000) / 2)
        expect(rowIdx, `cut ${c} inside a sampled row`).toBeGreaterThanOrEqual(0)
      }
    }, 120_000)

    it("a cut in the source between two kept spans is not decoded, so it is not reported — the next row's start is where a consumer places the possible cut", async () => {
      const r = await encodeVideoProxy(p("cuts.mp4"), await work("cuts-gap"), {
        fps: 2, height: 108, spans: [{ startMs: 0, endMs: 3500 }, { startMs: 8000, endMs: 11_000 }],
      })
      expect(r.cuts).toEqual([])
      // Both real cuts (4004 and 7007 ms) fall after the first row's last sample and at or before the
      // second row's first: a boundary at that row's sourceStartMs separates every sample either side.
      expect(r.spanMap).toHaveLength(2)
      const [first, second] = r.spanMap
      expect(first.sourceStartMs + (first.frameCount - 1) * 500).toBeLessThan(frameMs(120))
      expect(second.sourceStartMs).toBeGreaterThanOrEqual(frameMs(210))
    }, 120_000)

    it("a cut right at a span's end belongs to the next span's read, never to both", async () => {
      // The cut at frame 120 (4004 ms) is past the first span's end (4000 ms).
      const r = await encodeVideoProxy(p("cuts.mp4"), await work("cuts-edge"), {
        fps: 2, height: 108, spans: [{ startMs: 1000, endMs: 4000 }, { startMs: 6500, endMs: 7500 }],
      })
      expectCutsAt(r.cuts, [210])
    }, 120_000)

    it("two hard cuts 300 ms apart are not lost: at least one cut, each at the first frame of a new shot", async () => {
      const r = await encodeVideoProxy(p("cuts-close.mp4"), await work("cuts-close"), { fps: 2, height: 108 })
      // The shot changes at source frames 60 (bars) and 69 (mandelbrot).
      expect(r.cuts.length).toBeGreaterThanOrEqual(1)
      for (const c of r.cuts) expect(Math.min(Math.abs(c - frameMs(60)), Math.abs(c - frameMs(69))), `cut at ${c} ms`).toBeLessThan(1)
    }, 120_000)

    it("a dissolve is never reported as a run of cuts, and nothing outside it is", async () => {
      const r = await encodeVideoProxy(p("dissolve.mp4"), await work("dissolve"), { fps: 2, height: 108 })
      expect(r.cuts.length).toBeLessThanOrEqual(1)
      for (const c of r.cuts) expect(c >= 3000 && c <= 4000 + SRC_FRAME_MS, `cut at ${c}`).toBe(true)
    }, 120_000)

    it("a handheld shake is camera motion, not a run of cuts", async () => {
      const r = await encodeVideoProxy(p("shake.mp4"), await work("shake"), { fps: 2, height: 108 })
      expect(r.cuts).toEqual([])
    }, 120_000)

    it("a camera flash (one white frame) is not a cut: the picture comes straight back", async () => {
      const r = await encodeVideoProxy(p("flash.mp4"), await work("flash"), { fps: 2, height: 108 })
      expect(r.cuts).toEqual([])
    }, 120_000)

    for (const held of [2, 3]) {
      it(`a flash held for ${held} frames is not a cut either: the picture before it comes back within the look-ahead`, async () => {
        const r = await encodeVideoProxy(p(`flash-${held}.mp4`), await work(`flash-${held}`), { fps: 2, height: 108 })
        expect(r.cuts).toEqual([])
      }, 120_000)
    }

    it("a static shot with camera grain has no cut", async () => {
      const r = await encodeVideoProxy(p("grain.mp4"), await work("grain"), { fps: 2, height: 108 })
      expect(r.cuts).toEqual([])
    }, 120_000)
  })

  it("a source with no picture is a typed deterministic error", async () => {
    const err = await encodeVideoProxy(p("audio.m4a"), await work("audio"), { fps: 2, height: 108 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaHasNoVideoError)
    expect(err).toBeInstanceOf(DeterministicJobError)
  }, 60_000)
})
