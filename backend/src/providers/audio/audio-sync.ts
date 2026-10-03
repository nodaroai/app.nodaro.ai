/**
 * AUDIO SYNC — measure how far apart the clocks of 2–6 recordings of one
 * conversation are (camera files and/or a master mic), so a multicam edit lines
 * up without anyone typing offsets. Core, keyless: ffmpeg decodes, plain
 * TypeScript correlates (`audio-sync-dsp.ts`).
 *
 * Output (`data`): `{ version, reference, offsets: [{ sourceId, offsetMs,
 * confidence, driftMsPerHour }], notes }`, keyed by the caller's source ids and
 * shaped for `mergeEdlSourceOffsets` (D19: `masterMs = sourceMs + offsetMs`,
 * measured against `reference`, whose own offset is 0).
 *
 * METHOD, per source against the reference:
 *  1. COARSE — onset envelopes of the whole of both (8 kHz, one value per
 *     10–20 ms hop) cross-correlated: finds the offset at any distance, e.g. a
 *     camera started four minutes before the mic.
 *  2. FINE — raw 8 kHz waveforms correlated (GCC-PHAT) inside a search around
 *     the coarse answer on up to three 10-second windows (middle first, then
 *     start / end of the overlap): sub-millisecond.
 *  3. DRIFT — a line through the windows' offsets: its slope is clock drift
 *     (separate recorders run 20–100 ppm apart). Reported, not corrected (decided
 *     2026-09-25): the offset is taken at the MIDDLE of the overlap, which halves
 *     the worst error, and a note warns when the drift over the overlap exceeds a
 *     frame (33 ms).
 *  4. CONFIDENCE in [0, 1] — how sharply each fine window locks (its PHAT
 *     peak over the strongest value more than 2 ms away) and, with three
 *     windows, how well they sit on one line (random false peaks cannot). With a
 *     single window, how clearly the coarse alignment beats every other. Drift
 *     smears the coarse peak and decorrelates raw waveforms, so neither of those
 *     may cap a result three windows agree on to a fraction of a millisecond.
 *     Low confidence is a result, not an error: a silent camera has nothing to
 *     align.
 */
import { spawn } from "node:child_process"
import { join } from "node:path"
import {
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  ffmpegFailureMessage,
  probeMediaDuration,
  withFfmpegSlot,
} from "../video/ffmpeg-utils.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { ensureMediaProxy, MediaHasNoAudioError } from "../../services/media-proxy.js"
import { INPUT_SEEK_MARGIN_SEC } from "../video/apply-edl-budget.js"
import { crossCorrelate, fitLine, OnsetEnvelope, peakLag, peakToSidelobe } from "./audio-sync-dsp.js"
import {
  AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS,
  AUDIO_SYNC_FINE_WINDOWS,
  AUDIO_SYNC_MAX_SOURCES,
  AUDIO_SYNC_MIN_SOURCES,
  AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS,
} from "./audio-sync-budget.js"

/** Wire version of the emitted `data`. Bump only on a breaking shape change. */
export const AUDIO_SYNC_VERSION = 1 as const
/** Everything is correlated at this rate: speech lives below 4 kHz. */
export const AUDIO_SYNC_SAMPLE_RATE = 8_000
/** Drift over the overlap past which a note warns (one frame at 30 fps). */
export const AUDIO_SYNC_DRIFT_WARN_MS = 33
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const round2 = (x: number) => Math.round(x * 100) / 100

/** Below this confidence a note says the offset should be checked by ear. */
export const AUDIO_SYNC_LOW_CONFIDENCE = 0.5
/** Below this, the note says there is no clear match at all (a guess). */
export const AUDIO_SYNC_NO_MATCH_CONFIDENCE = 0.2

/**
 * Confidence in [0, 1] from what the fine pass saw.
 *
 * THREE WINDOWS that sit on one line are the strongest evidence there is: a
 * false peak lands anywhere in its search range, so three of them on one line
 * (to a millisecond) do not happen by chance — however weak each peak is. Real
 * speech through a room gives PHAT peaks only 1.3–2× their surroundings even
 * when the answer is exact (measured on 8.1.2: a reverberant camera, three
 * windows agreeing to 0.01 ms, peaks 1.5–1.7), so agreement sets the floor
 * (0.6 at ≤ 1 ms, falling to 0 at 5 ms) and a sharp lock lifts it to 1. A
 * CONSISTENT bias (heavy reverb pulling every window the same way) also agrees;
 * the measured worst case was 13 ms, inside the spec's ±20 ms.
 *
 * FEWER WINDOWS (an overlap under 6 minutes) cannot cross-check: the lock and
 * how clearly the whole-recording alignment beats every other must both hold.
 */
export function audioSyncConfidence(m: {
  readonly prominences: readonly number[]
  readonly windows: number
  readonly maxResidualMs: number
  readonly coarsePsr: number
}): number {
  const sorted = m.prominences.slice().sort((x, y) => x - y)
  const prominence = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0
  const lock = clamp01((prominence - 1.5) / 2.5)
  if (m.windows >= 3) {
    const agreement = clamp01(1 - (m.maxResidualMs - 1) / 4)
    return round2(agreement * (0.6 + 0.4 * lock))
  }
  return round2(Math.min(lock, clamp01((m.coarsePsr - 1.2) / 1.8)))
}

const MIN_OVERLAP_SEC = 2
/** Fine windows are short so a drifting pair barely slides within one (200 ppm
 *  × 10 s = 2 ms): a longer window smears the PHAT peak across the slide. */
const FINE_WINDOW_SEC = 10
/** Overlaps this long get all three fine windows (start / middle / end). */
const THREE_WINDOWS_MIN_OVERLAP_SEC = 6 * 60
/** The largest clock drift the fine pass searches for: past any real pair of
 *  recorders (20–100 ppm). The search around a window grows with it — see the
 *  fine pass in `runAudioSyncOnFiles`. */
const MAX_DRIFT = 200e-6
/** The coarse envelope pair's FFT stays at 2^21 values (~64 MB in flight): two
 *  envelopes of ceil(duration / hop) values each fit when their total is at
 *  most 2^21 − 2, so the hop grows in 10 ms steps for very long sources. */
const MAX_ENVELOPE_PAIR = 2 ** 21 - 2

export interface AudioSyncOffset {
  readonly sourceId: string
  /** D19 against the reference: `referenceMs = sourceMs + offsetMs`. Integer ms. */
  readonly offsetMs: number
  /** 0..1; below `AUDIO_SYNC_LOW_CONFIDENCE` a note explains. */
  readonly confidence: number
  /** Measured clock drift against the reference (ms gained per hour); `null`
   *  when the overlap was too short to place more than one window. */
  readonly driftMsPerHour: number | null
}

export interface AudioSyncResult {
  readonly version: typeof AUDIO_SYNC_VERSION
  /** The source every offset is measured against (its own offset is 0). */
  readonly reference: string
  readonly offsets: AudioSyncOffset[]
  /** Human-readable warnings (low confidence, drift, no shared sound). */
  readonly notes: string[]
}


/**
 * Stream a local file's audio as mono float PCM at 8 kHz (speech band) under a
 * shared ffmpeg slot, calling `onSamples` per chunk — so a 3-hour source never
 * sits in memory whole. `startSec`/`durationSec` seek to a window.
 */
async function streamPcm(
  path: string,
  win: { readonly startSec?: number; readonly durationSec?: number },
  timeoutMs: number,
  onSamples: (x: Float32Array) => void,
): Promise<void> {
  // A window seeks like apply-edl does (INPUT_SEEK_MARGIN_SEC early), then
  // trims on DECODED timestamps: an AAC input (every media proxy is AAC) seeked
  // straight to the window start came back 2–9 ms off, and differently per seek,
  // while the same seek-then-trim puts the window on the clock the render reads.
  const start = Math.max(0, win.startSec ?? 0)
  const seek = Math.max(0, start - INPUT_SEEK_MARGIN_SEC)
  const trim = start > 0 || win.durationSec !== undefined
    ? `atrim=start=${(start - seek).toFixed(6)}${win.durationSec !== undefined ? `:duration=${win.durationSec.toFixed(6)}` : ""},asetpts=PTS-STARTPTS,`
    : ""
  const args = [
    "-hide_banner", "-nostats", "-v", "error",
    ...(seek > 0 ? ["-ss", seek.toFixed(3)] : []),
    "-i", path,
    "-vn", "-ac", "1", "-ar", String(AUDIO_SYNC_SAMPLE_RATE), "-af", `${trim}highpass=f=120`,
    "-f", "f32le", "pipe:1",
  ]
  await withFfmpegSlot(() => new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    let carry = Buffer.alloc(0)
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), timeoutMs)
    proc.stdout.on("data", (chunk: Buffer) => {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const whole = buf.length - (buf.length % 4)
      if (whole > 0) {
        const aligned = Buffer.from(buf.subarray(0, whole)) // own the bytes: 4-aligned for the view
        onSamples(new Float32Array(aligned.buffer, aligned.byteOffset, whole / 4))
      }
      carry = Buffer.from(buf.subarray(whole))
    })
    proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-8_000) })
    proc.on("error", (err) => { clearTimeout(watchdog); reject(err) })
    proc.on("close", (code, signal) => {
      clearTimeout(watchdog)
      if (code === 0) resolve()
      else reject(new Error(ffmpegFailureMessage(stderr, signal ? `killed (${signal}) after ${timeoutMs} ms` : `exit ${code}`)))
    })
  }))
}

async function decodeWindow(path: string, startSec: number, durationSec: number): Promise<Float32Array> {
  const parts: Float32Array[] = []
  await streamPcm(path, { startSec, durationSec }, AUDIO_SYNC_WINDOW_DECODE_TIMEOUT_MS, (x) => parts.push(x))
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

async function envelopeOf(path: string, hopSec: number): Promise<Float64Array> {
  const env = new OnsetEnvelope(hopSec * AUDIO_SYNC_SAMPLE_RATE)
  await streamPcm(path, {}, AUDIO_SYNC_ENVELOPE_DECODE_TIMEOUT_MS, (x) => env.push(x))
  return env.finish()
}

/** Refine one window: the reference's [t0, t0 + w) against the source around
 *  the expected lag `d`, ± `margin`. The lag comes from GCC-PHAT (a sharp peak
 *  at the direct path, where a reverberant camera's plain correlation drifts
 *  toward the reflections); `prominence` is that peak over the strongest value
 *  outside its own width in the searched range — ≥ ~4 is a clean lock, ~1 is
 *  none. */
async function fineLag(
  refPath: string,
  srcPath: string,
  t0: number,
  w: number,
  d: number,
  margin: number,
): Promise<{ readonly lag: number; readonly prominence: number } | undefined> {
  const sr = AUDIO_SYNC_SAMPLE_RATE
  const s0 = Math.max(0, t0 - d - margin)
  const [refW, srcW] = [await decodeWindow(refPath, t0, w), await decodeWindow(srcPath, s0, w + 2 * margin)]
  if (refW.length < sr || srcW.length < sr) return undefined
  const { atLag, minLag, maxLag } = crossCorrelate(refW, srcW, { phat: true })
  // A match at lag k pairs ref[i + k] (reference time t0 + (i + k)/sr) with
  // src[i] (source time s0 + i/sr): lag = t0 − s0 + k/sr. Expected near d.
  const k0 = Math.round((d - t0 + s0) * sr)
  const lo = Math.max(minLag, k0 - Math.ceil(margin * sr))
  const hi = Math.min(maxLag, k0 + Math.ceil(margin * sr))
  if (lo > hi) return undefined
  const pk = peakLag(atLag, lo, hi)
  // The peak's own width: half a millisecond, plus what the largest drift we
  // search for can slide it within this window.
  const prominence = peakToSidelobe(atLag, lo, hi, pk.index, Math.round((0.0005 + MAX_DRIFT * w) * sr))
  return { lag: t0 - s0 + pk.lag / sr, prominence }
}

/**
 * Align LOCAL files (real ffmpeg, no network) — the unit the e2e test drives.
 * `files[i].id` becomes `sourceId`; `referenceId` defaults to the first file.
 */
export async function runAudioSyncOnFiles(
  files: ReadonlyArray<{ readonly id: string; readonly path: string }>,
  referenceId?: string,
): Promise<AudioSyncResult> {
  if (files.length < AUDIO_SYNC_MIN_SOURCES || files.length > AUDIO_SYNC_MAX_SOURCES) {
    throw new Error(`audio-sync: needs ${AUDIO_SYNC_MIN_SOURCES}–${AUDIO_SYNC_MAX_SOURCES} sources, got ${files.length}`)
  }
  if (new Set(files.map((f) => f.id)).size !== files.length) throw new Error("audio-sync: source ids must be unique")
  const reference = referenceId ?? files[0]!.id
  const ref = files.find((f) => f.id === reference)
  if (!ref) throw new Error(`audio-sync: reference "${reference}" is not one of the sources`)

  const durations = new Map<string, number>()
  for (const f of files) durations.set(f.id, await probeMediaDuration(f.path))
  const refDur = durations.get(reference)!
  const longest = Math.max(...files.filter((f) => f.id !== reference).map((f) => durations.get(f.id)!))
  const hopSec = 0.01 * Math.max(1, Math.ceil((refDur + longest) / (0.01 * MAX_ENVELOPE_PAIR)))
  const refEnv = await envelopeOf(ref.path, hopSec)

  const notes: string[] = []
  const offsets: AudioSyncOffset[] = []
  for (const f of files) {
    if (f.id === reference) {
      offsets.push({ sourceId: f.id, offsetMs: 0, confidence: 1, driftMsPerHour: 0 })
      continue
    }
    const srcDur = durations.get(f.id)!
    const srcEnv = await envelopeOf(f.path, hopSec)
    const coarse = crossCorrelate(refEnv, srcEnv)
    const pk = peakLag(coarse.atLag, coarse.minLag, coarse.maxLag)
    const psr = peakToSidelobe(coarse.atLag, coarse.minLag, coarse.maxLag, pk.index, Math.round(0.5 / hopSec))
    const d = pk.lag * hopSec

    // The overlap on the reference clock: the source covers [d, d + srcDur].
    const a = Math.max(0, d)
    const b = Math.min(refDur, d + srcDur)
    if (b - a < MIN_OVERLAP_SEC || pk.value <= 0) {
      offsets.push({ sourceId: f.id, offsetMs: Math.round(d * 1000), confidence: 0, driftMsPerHour: null })
      notes.push(`"${f.id}": no clear sound shared with "${reference}" — its offset is a guess; check it by ear.`)
      continue
    }
    // FINE PASS. Drift smears the coarse peak — for a pair drifting at `r`,
    // the envelopes agree anywhere across the r·span they slide apart — so the
    // MIDDLE window is searched ± that whole slide (at the largest drift we
    // look for), and gives the lag the others are predicted from. Each other
    // window is then searched ± the drift it can have gathered since the middle.
    // A fixed ± 100 ms missed the ends of a 40-minute overlap at 100 ppm.
    const base = Math.max(0.1, 3 * hopSec)
    const span = b - a
    const mid = a + span / 2
    const others = span >= THREE_WINDOWS_MIN_OVERLAP_SEC
      ? [0.1, 0.9].slice(0, AUDIO_SYNC_FINE_WINDOWS - 1).map((p) => a + p * span)
      : []
    const points: Array<{ t: number; lag: number }> = []
    const prominences: number[] = []
    const measure = async (c: number, expected: number, margin: number) => {
      const w = Math.min(FINE_WINDOW_SEC, span - 2 * margin)
      if (w < 1) return undefined
      const t0 = Math.min(Math.max(a + margin, c - w / 2), b - margin - w)
      const fine = await fineLag(ref.path, f.path, t0, w, expected, margin)
      if (!fine) return undefined
      points.push({ t: t0 + w / 2, lag: fine.lag })
      prominences.push(fine.prominence)
      return fine.lag
    }
    const midLag = await measure(mid, d, base + (MAX_DRIFT * span) / 2)
    for (const c of others) await measure(c, midLag ?? d, base + MAX_DRIFT * Math.abs(c - mid))
    const fit = fitLine(points.length > 0 ? points : [{ t: (a + b) / 2, lag: d }])
    const offsetSec = fit.at((a + b) / 2)
    const drift = points.length >= 2 ? fit.slope : null
    const confidence = audioSyncConfidence({ prominences, windows: points.length, maxResidualMs: fit.maxResidual * 1000, coarsePsr: psr })

    offsets.push({
      sourceId: f.id,
      offsetMs: Math.round(offsetSec * 1000),
      confidence,
      driftMsPerHour: drift === null ? null : Math.round(drift * 3_600_000 * 10) / 10,
    })
    if (confidence < AUDIO_SYNC_NO_MATCH_CONFIDENCE) {
      notes.push(`"${f.id}": no clear match with "${reference}" (confidence ${confidence}) — its offset is a guess; check it by ear.`)
    } else if (confidence < AUDIO_SYNC_LOW_CONFIDENCE) {
      notes.push(`"${f.id}": a weak match with "${reference}" (confidence ${confidence}) — check this offset by ear.`)
    }
    if (drift !== null && Math.abs(drift) * span * 1000 > AUDIO_SYNC_DRIFT_WARN_MS) {
      const over = Math.round(Math.abs(drift) * span * 1000)
      notes.push(
        `"${f.id}": its clock drifts against "${reference}" by ${over} ms over the ${Math.round(span / 60)} shared minutes. ` +
        `The offset is taken at the middle, so the ends are off by up to ${Math.round(over / 2)} ms (drift is measured, not corrected).`,
      )
    }
  }
  return { version: AUDIO_SYNC_VERSION, reference, offsets, notes }
}

/**
 * Align remote sources. Each is read through its cached 16 kHz mono audio proxy
 * (`ensureMediaProxy`) — the same proxy `silence-detect` reads.
 * A source with NO audio track (a picture-only camera file) is a row of its own
 * at confidence 0 with a note — it has nothing to align, which is a result, not
 * a reason to fail the other sources. The reference is the clock, so a
 * reference without audio fails the job, naming it.
 */
export async function audioSync(
  sources: ReadonlyArray<{ readonly id: string; readonly url: string }>,
  referenceId?: string,
): Promise<AudioSyncResult> {
  const reference = referenceId ?? sources[0]?.id
  const workDir = await createWorkDir("audio-sync")
  try {
    const files: Array<{ id: string; path: string }> = []
    const silent = new Set<string>()
    for (const [i, s] of sources.entries()) {
      // The proxy step checks for an audio track on the file it downloads — no
      // probe of the URL itself, which must not be fetched from here (own-storage
      // uploads on a self-hosted install live on a private address the URL
      // guard refuses; the proxy's download path resolves them).
      let proxy: Awaited<ReturnType<typeof ensureMediaProxy>>
      try {
        proxy = await ensureMediaProxy(s.url, "audio")
      } catch (err) {
        if (!(err instanceof MediaHasNoAudioError)) throw err
        if (s.id === reference) {
          throw new DeterministicJobError(`audio-sync: the reference "${s.id}" has no audio track — choose a source with sound as the reference`)
        }
        silent.add(s.id)
        continue
      }
      const path = join(workDir, `src-${i}.m4a`)
      await downloadFile(proxy.url, path)
      files.push({ id: s.id, path })
    }
    const measured: AudioSyncResult = files.length >= AUDIO_SYNC_MIN_SOURCES
      ? await runAudioSyncOnFiles(files, reference)
      : { version: AUDIO_SYNC_VERSION, reference: reference!, offsets: [{ sourceId: reference!, offsetMs: 0, confidence: 1, driftMsPerHour: 0 }], notes: [] }
    const byId = new Map(measured.offsets.map((o) => [o.sourceId, o]))
    return {
      ...measured,
      offsets: sources.map((s) => byId.get(s.id) ?? { sourceId: s.id, offsetMs: 0, confidence: 0, driftMsPerHour: null }),
      notes: [
        ...measured.notes,
        ...sources.filter((s) => silent.has(s.id)).map((s) => `"${s.id}": has no audio track, so it cannot be aligned by sound — set its offset by hand.`),
      ],
    }
  } finally {
    await cleanupWorkDir(workDir)
  }
}
