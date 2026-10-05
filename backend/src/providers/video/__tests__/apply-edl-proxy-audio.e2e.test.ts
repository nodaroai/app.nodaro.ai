/**
 * Real-ffmpeg cases for a PROXY (review) render's sound, A1c (TA7, decided
 * 2026-10-04): a preview is the originals at ≤720p, at the final's frame rate,
 * with lighter MONO sound — AAC at 96 kbps, still at 48 kHz, so it keeps the
 * final's timing sample for sample.
 *
 * The harness mirrors `apply-edl.e2e.test.ts`: a synchronous
 * ffmpeg-availability skip (CI installs the production-pinned build), a partial
 * mock of ONLY `downloadFile` so the sources "download" from local lavfi
 * fixtures (safeFetch untouched), and a recorder of every ffmpeg spawn, so a
 * case pins HOW the render encoded, not only what it produced. Every render is
 * `checkpoint:false` and must never reach storage.
 *
 * Each case renders a proxy AND a final of one edit through one of the four
 * places a render encodes AAC — a single-pass video's inline sound, a
 * single-pass audio render, a chunked audio render's join, and a chunked video
 * render's mux (option B) — and checks that the proxy:
 *   - is ONE channel at 48 kHz, at 96 kbps (the final stays two, at 192 kbps);
 *   - is exactly the edit's length, as the final is: its samples end on the
 *     edit's last one, as the container counts them (the pinned 8.1.2 and 9.0
 *     both read that to the sample); and it decodes to as many samples as the
 *     final (whole AAC frames on 8.1.2, so that count alone is frame-exact);
 *   - lines up with the final at every cut (lag 0) and is as loud as it is —
 *     it is the AVERAGE of the final's two channels.
 * One source is mono and one is true stereo (a different tone per channel), so
 * the downmix is a real one, not a mono source upmixed and folded back.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"
import type { Edl } from "@nodaro/shared"
import { ffmpegAvailable, makeSource } from "./apply-edl-e2e-helpers.js"

// Records every ffmpeg spawn applyEdl makes.
const ff = vi.hoisted(() => ({ calls: [] as string[][] }))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    runFfmpeg: async (args: readonly string[], timeoutMs?: number): Promise<string> => {
      ff.calls.push([...args])
      return actual.runFfmpeg(args, timeoutMs)
    },
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.APPLY_EDL_FIXTURE_DIR
      if (!dir) throw new Error("fixture dir not set")
      await fs.copyFile(join(dir, basename(new URL(url).pathname)), dest)
    },
  }
})
// A `checkpoint:false` render never imports storage; if one ever did, it fails here.
vi.mock("../../../lib/storage.js", () => {
  const untouchable = async (): Promise<never> => {
    throw new Error("a checkpoint:false render must not touch storage")
  }
  return { getR2ObjectSize: untouchable, downloadR2ObjectToFile: untouchable, uploadFileWithKeyToR2: untouchable, deleteFromR2: untouchable }
})

// Every case spawns real ffmpeg (two renders and their decodes); a shared CI
// runner can take well over vitest's 5 s default.
vi.setConfig({ testTimeout: 120_000 })

const { applyEdl } = await import("../apply-edl.js")

const RATE = 48_000
/** The final's two channels averaged — the mix a proxy must carry. */
const AVERAGE = "pan=mono|c0=0.5*FL+0.5*FR"

/** A 320×240@30 source whose sound is TRUE stereo: one tone per channel. */
async function makeStereoSource(path: string, color: string, leftHz: number, rightHz: number, durationSec: number): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x240:r=30:d=${durationSec}`,
    "-f", "lavfi", "-i", `aevalsrc=0.125*sin(2*PI*${leftHz}*t)|0.125*sin(2*PI*${rightHz}*t):s=${RATE}:d=${durationSec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ])
}

/** The audio stream's channels and sample rate (JSON: csv shapes vary by container). */
async function audioStream(path: string): Promise<{ channels: number; sampleRate: number }> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate", "-of", "json", path])
  const s = (JSON.parse(out) as { streams: Array<{ channels: number; sample_rate: string }> }).streams[0]!
  return { channels: s.channels, sampleRate: Number(s.sample_rate) }
}

/** Where the audio track's samples end, as its container counts them: the
 *  latest packet end (`pts + duration`, in the stream's 1/48000 time base).
 *  The pinned 8.1.2 and 9.0 both read that to the sample. The track's
 *  `duration_ts` would not do: 8.1.2 reports it only to the millisecond
 *  (211,680 for a 211,700-sample track). */
async function trackEndSamples(path: string): Promise<number> {
  const out = await runFfprobe(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=time_base:packet=pts,duration", "-of", "json", path])
  const j = JSON.parse(out) as { streams: Array<{ time_base: string }>; packets: Array<{ pts: number; duration: number }> }
  expect(j.streams[0]!.time_base).toBe(`1/${RATE}`)
  return Math.max(...j.packets.map((pk) => pk.pts + pk.duration))
}

/** The decoded sound as 32-bit float at its own rate — never resampled, so the
 *  count is the stream's. `mix` folds a stereo stream to one channel first. */
async function decode(path: string, dir: string, mix?: string): Promise<Float32Array> {
  const raw = join(dir, `pcm-${Math.random().toString(36).slice(2)}.f32`)
  await runFfmpeg(["-y", "-i", path, "-map", "0:a:0", ...(mix ? ["-af", mix] : []), "-f", "f32le", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

const rmsOf = (x: Float32Array, from = 0, to = x.length): number => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i]! * x[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}

/** The lag (samples) at which `b` best matches `a` within ±50 ms of sample
 *  `mid`, and the RMS of the residual there. */
function bestLag(a: Float32Array, b: Float32Array, mid: number): { lag: number; rms: number } {
  const win = 2_400
  let best = { lag: 0, err: Infinity }
  for (let lag = -8; lag <= 8; lag++) {
    let err = 0
    for (let i = mid - win; i < mid + win; i++) err += (a[i]! - b[i + lag]!) ** 2
    if (err < best.err) best = { lag, err }
  }
  return { lag: best.lag, rms: Math.sqrt(best.err / (2 * win)) }
}

/** What one AAC-encoding spawn asked the encoder for. */
const aacEncode = (args: readonly string[]) => ({
  bitrate: args[args.indexOf("-b:a") + 1],
  sampleRate: args[args.indexOf("-ar") + 1],
  channels: args[args.indexOf("-ac") + 1],
})

describe.skipIf(!ffmpegAvailable)("applyEdl: a proxy's sound is lighter mono at the final's timing (real ffmpeg, A1c)", () => {
  let dir: string
  const renderDirs: string[] = []
  const render = async (opts: Parameters<typeof applyEdl>[0]) => {
    const out = await applyEdl(opts)
    renderDirs.push(dirname(out.outputPath))
    return out
  }

  // Four hard cuts alternating a MONO source (440 Hz) and a STEREO one (660 Hz
  // left, 880 Hz right): 4.4 s of output, cuts at 1.3, 2.45 and 3.17 s.
  const EDIT: Edl = {
    version: 1,
    clock: "master",
    sources: [
      { id: "M", url: "https://fixtures.test/mono.mp4", kind: "video" },
      { id: "S", url: "https://fixtures.test/stereo.mp4", kind: "video" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 1300, video: "M" },
      { id: "s1", inMs: 1300, outMs: 2450, video: "S" },
      { id: "s2", inMs: 2450, outMs: 3170, video: "M" },
      { id: "s3", inMs: 3170, outMs: 4400, video: "S" },
    ],
  }
  const CUTS_SEC = [1.3, 2.45, 3.17]

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-proxy-audio-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    await makeSource(join(dir, "mono.mp4"), "red", 440, 6)
    await makeStereoSource(join(dir, "stereo.mp4"), "blue", 660, 880, 6)
  }, 120_000)

  afterAll(async () => {
    await Promise.all([dir, ...renderDirs].map((d) => fs.rm(d, { recursive: true, force: true })))
    delete process.env.APPLY_EDL_FIXTURE_DIR
  })

  // Two segments per chunk splits the edit at the 2.45 s cut: the chunked
  // shapes render lossless slices, so the seam is one of the cuts checked.
  const CHUNKED = { chunkThreshold: 1, maxSegmentsPerChunk: 2 } as const
  const SHAPES = [
    { name: "a single-pass video's inline sound", output: "video", chunking: {} },
    { name: "a single-pass audio render", output: "audio", chunking: {} },
    { name: "a chunked audio render (lossless slices joined, one AAC encode)", output: "audio", chunking: CHUNKED },
    { name: "a chunked video render (picture chunks, the sound muxed on once)", output: "video", chunking: CHUNKED },
  ] as const

  it.each(SHAPES)("$name: the proxy is mono at 48 kHz, the final's exact length, on its cuts and at its level", async ({ output, chunking }) => {
    const tag = `${output}-${"chunkThreshold" in chunking ? "chunked" : "single"}`
    ff.calls.length = 0
    const proxy = await render({ edl: EDIT, output, quality: "proxy", jobId: `t-pa-proxy-${tag}`, checkpoint: false, ...chunking })
    const proxyCalls = ff.calls.splice(0)
    const final = await render({ edl: EDIT, output, quality: "final", jobId: `t-pa-final-${tag}`, checkpoint: false, ...chunking })
    const finalCalls = ff.calls.splice(0)

    // ONE channel at 48 kHz; the final keeps its two.
    expect(await audioStream(proxy.outputPath)).toEqual({ channels: 1, sampleRate: RATE })
    expect(await audioStream(final.outputPath)).toEqual({ channels: 2, sampleRate: RATE })

    // Each render encodes AAC exactly once (a chunked render's slices are
    // lossless) — the proxy at 96 kbps mono, the final at 192 kbps stereo.
    const aac = (calls: string[][]) => calls.filter((a) => a.includes("aac"))
    expect(aac(proxyCalls)).toHaveLength(1)
    expect(aac(finalCalls)).toHaveLength(1)
    expect(aacEncode(aac(proxyCalls)[0]!)).toEqual({ bitrate: "96k", sampleRate: "48000", channels: "1" })
    expect(aacEncode(aac(finalCalls)[0]!)).toEqual({ bitrate: "192k", sampleRate: "48000", channels: "2" })
    // A chunked proxy's lossless slices are already the mono mix.
    const pcmChannels = (calls: string[][]) => calls.filter((a) => a.includes("pcm_f32le")).map((a) => a[a.indexOf("-ac") + 1])
    if ("chunkThreshold" in chunking) {
      expect(pcmChannels(proxyCalls).length).toBeGreaterThan(1)
      expect(new Set(pcmChannels(proxyCalls))).toEqual(new Set(["1"]))
      expect(new Set(pcmChannels(finalCalls))).toEqual(new Set(["2"]))
    } else {
      expect(pcmChannels(proxyCalls)).toEqual([])
    }

    // Sample-exact on 8.1.2 and 9.0 alike: the proxy's samples end exactly
    // where the final's do, on the edit's 211,200th (4.4 s at 48 kHz). The
    // decoded counts can't show that on the pinned 8.1.2: it decodes whole
    // 1024-sample frames without trimming the last one's padding (211,968
    // here, 207 frames), so a proxy that ended up to 768 samples late or 255
    // early would decode to the final's count. 9.0 trims to the sample.
    expect(final.durationMs).toBe(4_400)
    const editSamples = (final.durationMs * RATE) / 1000
    expect(await trackEndSamples(proxy.outputPath), "where the proxy's samples end").toBe(editSamples)
    expect(await trackEndSamples(final.outputPath), "where the final's samples end").toBe(editSamples)
    // And it decodes to the final's count: frame-exact on 8.1.2, bounded by
    // the last frame's padding.
    const p = await decode(proxy.outputPath, dir)
    const f = await decode(final.outputPath, dir, AVERAGE)
    expect(p.length).toBe(f.length)
    expect(p.length).toBeGreaterThanOrEqual(editSamples)
    expect(p.length).toBeLessThan(editSamples + 1024)

    // On the final's timing at every cut (lag 0, nothing dropped or doubled
    // there), and as loud as the final: the AVERAGE of its two channels.
    for (const t of CUTS_SEC) {
      const at = bestLag(f, p, Math.round(t * RATE))
      expect(at.lag, `cut at ${t} s`).toBe(0)
      expect(at.rms, `cut at ${t} s residual`).toBeLessThan(0.01)
    }
    const levelDb = 20 * Math.log10(rmsOf(p) / rmsOf(f))
    expect(Math.abs(levelDb), `proxy vs final level ${levelDb.toFixed(2)} dB`).toBeLessThan(0.5)
  }, 180_000)
})
