/**
 * Real-ffmpeg proof of Track 0.18's fix F5 (decided 2026-10-06): a 44.1 kHz
 * source renders SAMPLE-EXACT at 48 kHz, seeked or not, with cut points off
 * the 10 ms grid. Before F5 an unseeked 44.1 kHz master lost ~0.7 samples per
 * segment (−20 by segment 30: every `atrim` rounded to the 44.1 kHz grid and
 * the resampler's output length rounded again) and a seek off a whole second
 * shifted every segment by a constant fraction of a sample.
 *
 * What is asserted, on lossless PCM slices: the output holds EXACTLY
 * Σ dur·48 kHz samples, and every segment's lag against the source — the whole
 * file resampled to 48 kHz in one pass — is 0, at its head and at its tail.
 * Lag is the cross-correlation peak of a 8192-sample window (parabolic
 * sub-sample fit) over ±400 samples of a pink-noise source, which has one
 * unambiguous peak. For the lossless (WAV) source every output sample must
 * also equal that reference, head and tail of every segment included. The
 * executor's own probe of the source rate is covered by a full `applyEdl`
 * audio render of the AAC master: the same lag check; its length only to the
 * AAC frame its one encode pads to.
 *
 * Harness as in `apply-edl-seam.e2e.test.ts`: a synchronous ffmpeg-availability
 * skip (CI installs the production-pinned build), and a partial mock of ONLY
 * `downloadFile` so sources "download" from local lavfi fixtures.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { ffmpegAvailable } from "./apply-edl-e2e-helpers.js"
import { runFfmpeg, runFfprobe } from "../ffmpeg-utils.js"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
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

vi.setConfig({ testTimeout: 180_000 })

const { applyEdl, buildSliceCommand, sliceArgv } = await import("../apply-edl.js")

const SOURCE_SEC = 48

/** Cut lengths and gaps in ms, all off the 10 ms grid. */
const LENS = [1037, 1413, 703, 2291, 977, 1129, 853, 1667, 1031, 749, 1201, 919]
const GAPS = [503, 211, 1307, 97, 641, 389, 1013, 157, 733, 467, 271]
function cuts(firstMs: number): EdlSegment[] {
  let t = firstMs
  return LENS.map((len, k) => {
    const seg = { id: `c${k}`, inMs: t, outMs: t + len } as EdlSegment
    t += len + (GAPS[k] ?? 0)
    return seg
  })
}
const UNSEEKED = cuts(517) // earliest read inside the seek margin → no -ss
const SEEKED = cuts(20_623) // a seek off a whole second

const edlOf = (file: string, segments: readonly EdlSegment[]): Edl =>
  ({
    version: 1,
    clock: "master",
    sources: [{ id: "M", url: `https://fixture.test/${file}`, kind: "audio", role: "master-audio" }],
    segments,
  }) as unknown as Edl

/** Channel 0 of a file's first audio stream, as 48 kHz f32 (no resample for a 48 kHz file). */
async function decode48(path: string, resample: boolean): Promise<Float32Array> {
  const raw = join(tmpdir(), `rs-${Math.random().toString(36).slice(2)}.f32`)
  await runFfmpeg(["-y", "-i", path, "-map", "0:a:0", "-af", `${resample ? "aresample=48000," : ""}pan=mono|c0=c0`, "-f", "f32le", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

const L = 8192, M = 1024, R = 400
/** How many samples `out[o…]` sits AFTER `ref[s…]` (0 = aligned), to a fraction of a sample. */
function lag(out: Float32Array, o: number, ref: Float32Array, s: number): number {
  let best = -Infinity, k = -1
  const c = new Float64Array(2 * R + 1)
  for (let d = 0; d <= 2 * R; d++) {
    let acc = 0
    const base = s - R + d
    for (let j = 0; j < L; j++) acc += ref[base + j]! * out[o + j]!
    c[d] = acc
    if (acc > best) { best = acc; k = d }
  }
  const p = k > 0 && k < 2 * R ? (0.5 * (c[k - 1]! - c[k + 1]!)) / (c[k - 1]! - 2 * c[k]! + c[k + 1]!) : 0
  return R - (k + p)
}

/** Every segment's head and tail lag, and the output length the edit owes.
 *  `refStartMs`: where the reference's first sample sits on the source's
 *  timeline (a sound that starts after its file does). */
function measure(out: Float32Array, ref: Float32Array, segs: readonly EdlSegment[], refStartMs = 0) {
  const lags: number[] = []
  let o = 0
  for (const seg of segs) {
    const n = (seg.outMs - seg.inMs) * 48, s = (seg.inMs - refStartMs) * 48
    lags.push(lag(out, o + M, ref, s + M), lag(out, o + n - M - L, ref, s + n - M - L))
    o += n
  }
  return { lags, owed: o }
}

/** The largest |output − reference| over every sample of every segment. */
function maxSampleError(out: Float32Array, ref: Float32Array, segs: readonly EdlSegment[], refStartMs = 0): number {
  let worst = 0, o = 0
  for (const seg of segs) {
    const n = (seg.outMs - seg.inMs) * 48, s = (seg.inMs - refStartMs) * 48
    for (let j = 0; j < n; j++) worst = Math.max(worst, Math.abs(out[o + j]! - ref[s + j]!))
    o += n
  }
  return worst
}

describe.skipIf(!ffmpegAvailable)("a 44.1 kHz source renders sample-exact at 48 kHz (real ffmpeg, Track 0.18 F5)", () => {
  let dir: string
  const ref = new Map<string, Float32Array>()

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-resample-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    // Stereo at full level (both channels the noise), so channel 0 of the
    // render IS the source — no mono→stereo gain to undo.
    const noise = ["-f", "lavfi", "-i", `anoisesrc=r=44100:d=${SOURCE_SEC}:c=pink:a=0.5:seed=4410`, "-af", "pan=stereo|c0=c0|c1=c0"]
    await runFfmpeg(["-y", ...noise, "-c:a", "pcm_s16le", join(dir, "m44.wav")])
    await runFfmpeg(["-y", ...noise, "-c:a", "aac", "-b:a", "192k", join(dir, "m44.m4a")])
    // The reference: each whole file decoded and resampled to 48 kHz in one pass.
    for (const f of ["m44.wav", "m44.m4a"]) ref.set(f, await decode48(join(dir, f), true))
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
    delete process.env.APPLY_EDL_FIXTURE_DIR
  })

  for (const file of ["m44.wav", "m44.m4a"]) {
    for (const [name, segs] of [["unseeked", UNSEEKED], ["seeked off a whole second", SEEKED]] as const) {
      it(`${file}, ${name}: Σ dur·48 kHz samples, every segment at lag 0`, async () => {
        const edl = edlOf(file, segs)
        const cmd = buildSliceCommand(edl, segs, {
          output: "audio", audioCodec: "pcm", quality: "final", target: { width: 2, height: 2 }, fps: 30, chunkStartMs: 0,
          masterAudioId: "M", audioPresent: new Map([["M", true]]), audioSampleRate: new Map([["M", 44_100]]),
        })
        const out = join(dir, `${file}-${segs[0]!.inMs}.wav`)
        const graph = `${out}.graph`
        await fs.writeFile(graph, cmd.filterGraph)
        await runFfmpeg(sliceArgv(cmd, new Map([["M", join(dir, file)]]), graph, out))
        const pcm = await decode48(out, false)
        const { lags, owed } = measure(pcm, ref.get(file)!, segs)
        expect(pcm.length).toBe(owed)
        expect(owed).toBe(segs.reduce((n, s) => n + (s.outMs - s.inMs) * 48, 0))
        for (const l of lags) expect(Math.abs(l)).toBeLessThan(0.05)
        // Lossless source: every sample IS the source resampled as one stream,
        // to the segment's last sample (the cut's lead-in and lead-out). An AAC
        // source is not compared sample by sample: its decoder's noise
        // substitution draws differently after a seek, whatever the timing.
        if (file.endsWith(".wav")) expect(maxSampleError(pcm, ref.get(file)!, segs)).toBeLessThan(1e-5)
        // Seeked to a whole second, which is an exact sample at any integer rate.
        expect(cmd.inputSeekSec[0]).toBe(name === "unseeked" ? 0 : 18)
      })
    }
  }

  it("the executor measures the source's rate: an applyEdl render of the 44.1 kHz AAC master keeps every segment at lag 0", async () => {
    const { outputPath } = await applyEdl({
      edl: edlOf("m44.m4a", UNSEEKED), output: "audio", quality: "final", jobId: "resample-e2e", checkpoint: false,
    })
    try {
      const pcm = await decode48(outputPath, false)
      const { lags, owed } = measure(pcm, ref.get("m44.m4a")!, UNSEEKED)
      // One AAC encode: its end is padded to a whole frame, so the length is
      // checked to that frame; the timing is the claim.
      expect(Math.abs(pcm.length - owed)).toBeLessThan(1024)
      for (const l of lags) expect(Math.abs(l)).toBeLessThan(0.05)
    } finally {
      await fs.rm(dirname(outputPath), { recursive: true, force: true })
    }
  })
})

// A video container whose sound starts AFTER its picture (MKV/WebM, OBS and
// browser recordings, MPEG-TS): the file starts with its earliest stream, so
// the sound's first sample sits at `offMs`, not 0. A segment whose coarse
// whole second falls before that start must still read the sound at its true
// position — the coarse cut is rebased on the whole second, not on its first
// packet, and the resampler pads the head with silence. The PR graph that
// rebased on the first packet (`PTS-STARTPTS`) put every such segment late by
// the whole delay. 44.1 kHz @ 500 ms: the delay of the reported case; 32 kHz @
// 1 ms: a millisecond start (MKV's timestamp unit) that is a whole number of
// samples at both rates, which the resampler ignores unless told to compensate
// any delay (`min_comp=0`) — its default, 1 ms, needs a delay strictly greater.
describe.skipIf(!ffmpegAvailable)("a container whose sound starts after its picture still cuts at lag 0 (real ffmpeg, F5 review)", () => {
  let dir: string
  const LATE = [
    { file: "late44.mkv", rate: 44_100, offMs: 500 },
    { file: "late32.mkv", rate: 32_000, offMs: 1 },
  ] as const
  const ref = new Map<string, Float32Array>()
  // Unseeked (the earliest read is inside the seek margin), the first segment
  // at ~1 s: its coarse cut starts at 0, before the sound does.
  const segs = cuts(1000)

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "apply-edl-late-audio-"))
    process.env.APPLY_EDL_FIXTURE_DIR = dir
    for (const { file, rate, offMs } of LATE) {
      const wav = join(dir, `${file}.wav`)
      await runFfmpeg(["-y", "-f", "lavfi", "-i", `anoisesrc=r=${rate}:d=24:c=pink:a=0.5:seed=4410`, "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "pcm_s16le", wav])
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", "testsrc=s=64x64:r=30:d=25", "-itsoffset", String(offMs / 1000), "-i", wav,
        "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-c:a", "pcm_s16le", join(dir, file),
      ])
      ref.set(file, await decode48(wav, true))
    }
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
    delete process.env.APPLY_EDL_FIXTURE_DIR
  })

  for (const { file, rate, offMs } of LATE) {
    it(`${rate} Hz sound starting ${offMs} ms after the picture: every segment at lag 0, every sample the source's`, async () => {
      // The fixture is what it claims: the file starts at 0, its sound later.
      const starts = await runFfprobe(["-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "csv=p=0", join(dir, file)])
      expect(starts).toContain("video,0.000000")
      expect(starts).toContain(`audio,${(offMs / 1000).toFixed(6)}`)
      const cmd = buildSliceCommand(edlOf(file, segs), segs, {
        output: "audio", audioCodec: "pcm", quality: "final", target: { width: 2, height: 2 }, fps: 30, chunkStartMs: 0,
        masterAudioId: "M", audioPresent: new Map([["M", true]]), audioSampleRate: new Map([["M", rate]]),
      })
      expect(cmd.inputSeekSec[0]).toBe(0)
      const out = join(dir, `${file}-out.wav`)
      const graph = `${out}.graph`
      await fs.writeFile(graph, cmd.filterGraph)
      await runFfmpeg(sliceArgv(cmd, new Map([["M", join(dir, file)]]), graph, out))
      const pcm = await decode48(out, false)
      const { lags, owed } = measure(pcm, ref.get(file)!, segs, offMs)
      expect(pcm.length).toBe(owed)
      for (const l of lags) expect(Math.abs(l)).toBeLessThan(0.05)
      expect(maxSampleError(pcm, ref.get(file)!, segs, offMs)).toBeLessThan(1e-5)
    })
  }
})
