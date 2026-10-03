/**
 * Real-ffmpeg fixture builders and decoders shared by the apply-edl e2e files
 * (`apply-edl.e2e.test.ts`, `apply-edl-multicam.e2e.test.ts`). Not a test file
 * (vitest collects only `*.test.ts`, the build skips `__tests__/`).
 *
 * Every ffmpeg call here goes through `../ffmpeg-utils.js`, so it resolves to
 * the importing test file's `vi.mock` of that module — exactly as when these
 * helpers lived inside the test file.
 */
import { expect } from "vitest"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe, probeStreamEnds } from "../ffmpeg-utils.js"
import type { Edl } from "@nodaro/shared"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
export const ffmpegAvailable = isFfmpegAvailable()

/** The VBR-mp3 fixture needs libmp3lame; a build without it skips that one case. */
function isMp3EncoderAvailable(): boolean {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] }).toString().includes("libmp3lame")
  } catch {
    return false
  }
}
export const mp3EncoderAvailable = ffmpegAvailable && isMp3EncoderAvailable()

export async function makeSource(path: string, color: string, freq: number, durationSec: number): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x240:r=30:d=${durationSec}`,
    "-f", "lavfi", "-i", `sine=f=${freq}:r=48000:d=${durationSec}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    path,
  ])
}

export async function probeDurationSec(path: string): Promise<number> {
  const out = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])
  return parseFloat(out.trim())
}

export const colourOfFrame = (c: { r: number; g: number; b: number }): string =>
  c.r > 150 && c.g < 100 && c.b < 100 ? "red" : `?(${c.r},${c.g},${c.b})`

/** Average RGB at output time `t` (scale=1:1 averages the whole frame). */
export async function probeColor(path: string, t: number): Promise<{ r: number; g: number; b: number }> {
  const raw = join(tmpdir(), `ae-px-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-ss", String(t), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  return { r: buf[0], g: buf[1], b: buf[2] }
}

/** Every decoded frame's colour, run-length encoded: "R" red, "B" blue, "G"
 *  green, "~" anything else (a dissolve frame). Asserting the runs pins the
 *  EXACT frame each cut lands on — a sampled colour or a duration cannot see a
 *  single dropped frame that a clone at the chunk's end then hides. */
export async function frameRuns(path: string, strict = false): Promise<string> {
  const raw = join(tmpdir(), `ae-frames-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-i", path, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const runs: Array<[string, number]> = []
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const [r, g, b] = [buf[i]!, buf[i + 1]!, buf[i + 2]!]
    // strict: only a PURE source colour counts, so a dissolve frame — even one
    // barely into the blend — reads "~" and the dissolve's exact start shows.
    const c = strict
      ? r > 235 && g < 20 && b < 20 ? "R" : b > 235 && r < 20 && g < 20 ? "B" : g > 110 && g < 150 && r < 20 && b < 20 ? "G" : "~"
      : r > 150 && g < 60 && b < 60 ? "R" : b > 150 && r < 60 && g < 60 ? "B" : g > 80 && r < 60 && b < 60 ? "G" : "~"
    const last = runs[runs.length - 1]
    if (last && last[0] === c) last[1]++
    else runs.push([c, 1])
  }
  return runs.map(([c, n]) => `${c}${n}`).join(" ")
}

export function goertzel(samples: Float64Array, sampleRate: number, freq: number): number {
  const k = Math.round((samples.length * freq) / sampleRate)
  const w = (2 * Math.PI * k) / samples.length
  const coeff = 2 * Math.cos(w)
  let s1 = 0, s2 = 0
  for (let i = 0; i < samples.length; i++) {
    const s0 = samples[i] + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/** Dominant tone frequency (from a fixed set) in a 0.4 s window at output time `t`. */
export async function probeTone(path: string, t: number, candidates: number[]): Promise<number> {
  const raw = join(tmpdir(), `ae-pcm-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-ss", String(t), "-t", "0.4", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const n = Math.floor(buf.length / 2)
  const samples = new Float64Array(n)
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(i * 2) / 32768
  let best = candidates[0]
  let bestMag = -Infinity
  for (const f of candidates) {
    const mag = goertzel(samples, 8000, f)
    if (mag > bestMag) { bestMag = mag; best = f }
  }
  return best
}

/** Per-track packet ends (`probeStreamEnds`, not the container), the counted
 *  video frames and the ffmpeg build — both tracks must be measured. */
export const trackDetail = async (outputPath: string): Promise<{ drift: number; video: number; audio: number; vframes: string; ver: string }> => {
  const ends = await probeStreamEnds(outputPath)
  expect(ends.video.state).toBe("measured")
  expect(ends.audio.state).toBe("measured")
  const video = ends.video.state === "measured" ? ends.video.endSec : NaN
  const audio = ends.audio.state === "measured" ? ends.audio.endSec : NaN
  const vframes = (await runFfprobe(["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", outputPath])).trim()
  const ver = (await runFfmpeg(["-version"]).catch(() => "")).split("\n")[0] || "?"
  return { drift: Math.abs(video - audio), video, audio, vframes, ver }
}
// 30 fps canvas → one frame is 1/30 s. The grid holds the drift well inside it.
export const ONE_FRAME = 1 / 30

// ---------------------------------------------------------------------------
// Multicam harness (Phase-2 B1). The solid-colour / constant-tone fixtures
// above cannot see a read from the WRONG SECOND of a source, which is exactly
// what a mis-applied `offsetMs` produces. These cameras encode SOURCE TIME in
// every frame (a colour per source second, frame-indexed so it is exact), and
// the master encodes MASTER TIME in its tone (a step per second). The helpers
// decode EVERY frame / the whole sound track — never a sample.
// ---------------------------------------------------------------------------

/** A 320×240@30 camera whose picture cycles `letters` one SOURCE second at a
 *  time — RGB: red, green, blue; YCM: yellow, cyan, magenta — keyed on the
 *  frame index `N`, so second k is frames [30k, 30k+30) exactly. Carries a
 *  constant `toneHz` of its own so sound taken from the camera instead of the
 *  master is audible as the wrong frequency, never as silence. */
export async function makeTimecodedCam(path: string, letters: "RGB" | "YCM", toneHz: number, durationSec: number): Promise<void> {
  const k = "mod(floor(N/30)\\,3)"
  const [r, g, b] = letters === "RGB"
    ? [`255*eq(${k}\\,0)`, `255*eq(${k}\\,1)`, `255*eq(${k}\\,2)`]
    : [`255*(eq(${k}\\,0)+eq(${k}\\,2))`, `255*(eq(${k}\\,0)+eq(${k}\\,1))`, `255*(eq(${k}\\,1)+eq(${k}\\,2))`]
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=black:s=320x240:r=30:d=${durationSec},format=gbrp,geq=r='${r}':g='${g}':b='${b}'`,
    "-f", "lavfi", "-i", `sine=f=${toneHz}:r=48000:d=${durationSec}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path,
  ])
}

/** The master's tone at master second `m`: 300 Hz + 100 Hz per second, cycling
 *  every 10 s (300…1200 Hz). A read one second off is a different tone. */
export const MASTER_TONES = Array.from({ length: 10 }, (_, i) => 300 + 100 * i)
export const masterToneAt = (m: number): number => MASTER_TONES[Math.floor(m) % 10]!

const PALETTE: ReadonlyArray<readonly [string, number, number, number]> = [
  ["R", 255, 0, 0], ["G", 0, 255, 0], ["B", 0, 0, 255],
  ["Y", 255, 255, 0], ["C", 0, 255, 255], ["M", 255, 0, 255],
  ["W", 255, 255, 255], ["K", 0, 0, 0],
]
/** A palette letter when every channel is within 40 of it, else "~". */
const paletteOf = (r: number, g: number, b: number): string =>
  PALETTE.find(([, pr, pg, pb]) => Math.max(Math.abs(r - pr), Math.abs(g - pg), Math.abs(b - pb)) <= 40)?.[0] ?? "~"

const runLength = (tokens: readonly string[]): string => {
  const runs: Array<[string, number]> = []
  for (const t of tokens) {
    const last = runs[runs.length - 1]
    if (last && last[0] === t) last[1]++
    else runs.push([t, 1])
  }
  return runs.map(([c, n]) => `${c}${n}`).join(" ")
}

/** Every decoded frame as a palette token, run-length encoded ("R19 Y18 …").
 *  `boxed`: sample the interior of the left bar, the centre and the interior of
 *  the right bar separately — a PILLARBOXED frame (black bars, colour centre)
 *  reads as the LOWER-case letter, a full-frame one as the upper-case letter,
 *  anything else "~". A whole-frame average would read a boxed frame as "~". */
export async function frameTokenRuns(path: string, boxed = false): Promise<string> {
  const raw = join(tmpdir(), `ae-tok-${Math.random().toString(36).slice(2)}.raw`)
  const graph = boxed
    ? "[0:v]split=3[a][b][c];[a]crop=iw/16:ih/2:iw/64:ih/4,scale=1:1[l];[b]crop=iw/4:ih/2:3*iw/8:ih/4,scale=1:1[m];" +
      "[c]crop=iw/16:ih/2:iw-iw/64-iw/16:ih/4,scale=1:1[r];[l][m][r]hstack=inputs=3[out]"
    : "[0:v]scale=1:1[out]"
  await runFfmpeg(["-y", "-i", path, "-filter_complex", graph, "-map", "[out]", "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const px = (i: number) => paletteOf(buf[i]!, buf[i + 1]!, buf[i + 2]!)
  const tokens: string[] = []
  const stride = boxed ? 9 : 3
  for (let i = 0; i + stride - 1 < buf.length; i += stride) {
    if (!boxed) { tokens.push(px(i)); continue }
    const [l, m, r] = [px(i), px(i + 3), px(i + 6)]
    tokens.push(m === "~" || m === "K" ? "~" : l === "K" && r === "K" ? m.toLowerCase() : l === m && r === m ? m : "~")
  }
  return runLength(tokens)
}

/** The first and last non-black column on the middle row of output frame `n`. */
export async function contentColumns(path: string, n: number): Promise<{ first: number; last: number; width: number }> {
  const raw = join(tmpdir(), `ae-row-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-i", path, "-vf", `select=eq(n\\,${n}),crop=iw:2:0:ih/2`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const width = buf.length / 6 // two rows of rgb24
  let first = -1, last = -1
  for (let x = 0; x < width; x++) {
    if (buf[3 * x]! + buf[3 * x + 1]! + buf[3 * x + 2]! > 150) {
      if (first < 0) first = x
      last = x
    }
  }
  return { first, last, width }
}

/** The whole sound track, mono at 8 kHz. */
const SOUND_RATE = 8000
export async function decodeSound(path: string): Promise<Float64Array> {
  const raw = join(tmpdir(), `ae-snd-${Math.random().toString(36).slice(2)}.raw`)
  await runFfmpeg(["-y", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", String(SOUND_RATE), "-f", "s16le", raw])
  const buf = await fs.readFile(raw)
  await fs.rm(raw, { force: true })
  const out = new Float64Array(Math.floor(buf.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768
  return out
}

export type SoundExpect = number | "silence"

/** What a cut-only EDL's sound must be at output time `t`, from a model of
 *  each SOUND source (`sourceSound(id, sourceSec)`), resolved exactly as the
 *  D19 doctrine says: the segment's `audio`, else the master-audio source, else
 *  its `video` — read at `masterMs − offsetMs(source)`. */
export function soundModel(edl: Edl, sourceSound: (id: string, sourceSec: number) => SoundExpect): {
  at: (t: number) => { seg: number; expect: SoundExpect } | undefined
  totalSec: number
} {
  const master = edl.sources.find((s) => s.role === "master-audio")?.id
  const spans: Array<{ start: number; end: number; id: string; srcStart: number }> = []
  let cum = 0
  for (const seg of edl.segments) {
    const id = seg.audio ?? master ?? seg.video!
    const off = edl.sources.find((s) => s.id === id)?.offsetMs ?? 0
    const dur = (seg.outMs - seg.inMs) / 1000
    spans.push({ start: cum, end: cum + dur, id, srcStart: (seg.inMs - off) / 1000 })
    cum += dur
  }
  return {
    totalSec: cum,
    at: (t) => {
      const k = spans.findIndex((s) => t >= s.start && t < s.end)
      if (k < 0) return undefined
      const s = spans[k]!
      return { seg: k, expect: sourceSound(s.id, s.srcStart + (t - s.start)) }
    },
  }
}

/** Checks EVERY 100 ms window of the rendered sound (50 ms hop) against the
 *  model: a tone window must be loud and its dominant candidate the expected
 *  one; a silence window must be digital silence. A window is skipped when the
 *  model itself changes within 40 ms of it (a cut, a step of the master), so
 *  the checked windows nearest a change end or start 40-90 ms from it (the hop
 *  decides where in that range). What that resolves, by the kind of change:
 *    - silence↔tone: a sound shifted toward the silence past that gap fails —
 *      a few ms of tone breaks the −60 dB floor;
 *    - tone→tone (every master step, every cut between master windows): the
 *      dominant-tone pick flips only once the neighbour fills over half a
 *      window, so a shift under ~90 ms can pass and one past ~140 ms fails at
 *      every such change. Measured by mutating the master read: +60 ms passed
 *      the (a) tests outright, +110 ms failed every master-audio test.
 *  So this pins WHICH SECOND each sound comes from (what a mis-applied
 *  `offsetMs` produces), not sub-frame A/V sync: a one-AAC-frame (21 ms) or
 *  one-video-frame shift of the sound passes it. Returns the mismatches, plus
 *  how many windows each segment had checked (so a skip rule can never quietly
 *  hollow a segment out). */
export function soundMismatches(
  samples: Float64Array,
  model: ReturnType<typeof soundModel>,
  candidates: readonly number[],
): { mismatches: string[]; checkedPerSegment: number[] } {
  const WIN = 0.1, HOP = 0.05, GUARD = 0.04
  const mismatches: string[] = []
  const checkedPerSegment: number[] = []
  for (let t0 = 0; t0 + WIN <= model.totalSec; t0 += HOP) {
    const here = model.at(t0 + WIN / 2)
    if (!here) continue
    let stable = true
    for (let t = t0 - GUARD; t <= t0 + WIN + GUARD; t += 0.005) {
      const m = model.at(Math.min(Math.max(t, 0), model.totalSec - 1e-6))
      if (!m || m.expect !== here.expect) { stable = false; break }
    }
    if (!stable) continue
    const a = Math.round(t0 * SOUND_RATE), b = Math.round((t0 + WIN) * SOUND_RATE)
    const win = samples.subarray(a, b)
    let sumSq = 0
    for (const v of win) sumSq += v * v
    const db = win.length > 0 && sumSq > 0 ? 10 * Math.log10(sumSq / win.length) : -120
    let got: SoundExpect
    if (db < -60) got = "silence"
    else if (db < -40) got = NaN // neither a tone nor silence
    else {
      let best = candidates[0]!, bestMag = -Infinity
      for (const f of candidates) {
        const mag = goertzel(win, SOUND_RATE, f)
        if (mag > bestMag) { bestMag = mag; best = f }
      }
      got = best
    }
    checkedPerSegment[here.seg] = (checkedPerSegment[here.seg] ?? 0) + 1
    if (got !== here.expect) mismatches.push(`[${t0.toFixed(2)}s seg${here.seg}] want ${here.expect}, got ${Number.isNaN(got) ? `${db.toFixed(0)} dB` : got}`)
  }
  return { mismatches, checkedPerSegment }
}
