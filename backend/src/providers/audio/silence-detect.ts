/**
 * SILENCE DETECT — one ffmpeg `silencedetect` pass over an audio/video source,
 * returning the silence spans as `{ startMs, endMs }` ranges on the source's
 * own clock.
 *
 * WHY A PROXY. A podcast episode is a multi-GB original; every silence pass
 * only needs amplitude, so `detectSilence` reads the cached 16 kHz mono AAC
 * media proxy (`ensureMediaProxy`) instead of the original — the same proxy
 * `transcribe` reads, so a Tighten-episode workflow encodes it once.
 *
 * `silencedetect` is a METADATA-ONLY filter: it decodes the whole track and
 * emits `silence_start: <sec>` / `silence_end: <sec>` markers on STDERR without
 * transforming a sample (see the identical use in
 * `ee/pipelines/services/pipeline-extract-beat-grid.ts`). We run it with
 * `-f null -` so nothing is written, parse the markers, and pair them into
 * ranges.
 *
 * PADDING. `padMs` shrinks each detected silence INWARD by `padMs` at both ends
 * so a downstream cut keeps a little room around speech onsets/tails and never
 * clips a breath or a word's attack. A range that collapses to nothing after
 * padding is dropped.
 *
 * The pure parse (`parseSilenceRanges`) and the local-file pass
 * (`runSilenceDetectOnFile`) are exported so the ffmpeg pass can be exercised
 * end-to-end against a synthetic lavfi fixture without any network/R2.
 */
import { join } from "node:path"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  runFfmpegCapture,
  probeMediaDuration,
} from "../video/ffmpeg-utils.js"
import { DOWNLOAD_TIMEOUT_MS } from "../video/ffmpeg-timeouts.js"
import { ensureMediaProxy } from "../../services/media-proxy.js"
import { ALL_RANGES_MIN_FLOOR_MS } from "./silence-detect-limits.js"

/** Wire version of the emitted `data` payload. Bump only on a breaking shape
 *  change (a new major of the node's output contract). */
export const SILENCE_DETECT_VERSION = 1 as const

export interface SilenceRange {
  /** Silence start on the SOURCE clock, integer ms. */
  readonly startMs: number
  /** Silence end on the SOURCE clock, exclusive, integer ms, > startMs. */
  readonly endMs: number
}

export interface SilenceDetectResult {
  readonly version: typeof SILENCE_DETECT_VERSION
  readonly ranges: SilenceRange[]
  /** Every silence of at least `allRangesMinMs`, unpadded — only when that
   *  setting was given. */
  readonly allRanges?: SilenceRange[]
  /** Total source duration, integer ms. */
  readonly durationMs: number
}

export interface SilenceDetectSettings {
  /** RMS threshold below which a span counts as silence, in dBFS (negative).
   *  Default -35. */
  readonly thresholdDb: number
  /** Minimum span length to report, ms. Default 700. */
  readonly minSilenceMs: number
  /** Padding kept around speech, ms — shrinks each range inward by this at both
   *  ends. Default 120. */
  readonly padMs: number
  /** Also list every silence at least this long, unpadded, as `allRanges`
   *  (decided 2026-11-18: Tighten Episode's plan places the cut around a
   *  removed word inside the short silences next to it). Read from the same
   *  pass, run at the shorter of the two lengths. Absent: no list, and the
   *  pass is exactly the one it always was. */
  readonly allRangesMinMs?: number
}

export const SILENCE_DETECT_DEFAULTS: SilenceDetectSettings = {
  thresholdDb: -35,
  minSilenceMs: 700,
  padMs: 120,
}

/**
 * Parse `silencedetect` stderr markers into padded, clamped source-clock
 * ranges. Pure — no ffmpeg. Pairs each `silence_start` with the next
 * `silence_end`; a dangling `silence_start` (source ends mid-silence) is closed
 * at `durationMs`. Applies `padMs` inward and drops ranges that collapse.
 *
 * Format (ffmpeg):
 *   [silencedetect @ 0x…] silence_start: 12.345
 *   [silencedetect @ 0x…] silence_end: 15.678 | silence_duration: 3.333
 */
export function parseSilenceRanges(
  stderr: string,
  opts: { padMs: number; durationMs: number },
): SilenceRange[] {
  return padSilences(parseSilenceSpans(stderr, opts.durationMs), opts.padMs)
}

/**
 * The `silencedetect` markers paired into source-clock spans as ffmpeg found
 * them — unpadded, in emission order. A dangling `silence_start` (source ends
 * mid-silence) is closed at `durationMs`. Pure.
 */
export function parseSilenceSpans(stderr: string, durationMsIn: number): SilenceRange[] {
  return parseTimedSilences(stderr, durationMsIn).map(({ startMs, endMs }) => ({ startMs, endMs }))
}

/** A span with its length as ffmpeg measured it, before the edges were rounded to the millisecond. */
interface TimedSilence extends SilenceRange {
  readonly lengthSec: number
}

function parseTimedSilences(stderr: string, durationMsIn: number): TimedSilence[] {
  const durationMs = Math.max(0, Math.round(durationMsIn))
  const spans: TimedSilence[] = []

  let open: { ms: number; sec: number } | null = null
  // Scan line by line so start/end stay in emission order even if a stray
  // token appears elsewhere on a line.
  for (const line of stderr.split("\n")) {
    const startMatch = /silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/.exec(line)
    if (startMatch) {
      // A new start before the previous one closed (shouldn't happen, but be
      // defensive): drop the earlier unterminated span.
      const sec = parseFloat(startMatch[1]!)
      open = { ms: Math.max(0, Math.round(sec * 1000)), sec }
      continue
    }
    const endMatch = /silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)/.exec(line)
    if (endMatch && open !== null) {
      const sec = parseFloat(endMatch[1]!)
      spans.push({ startMs: open.ms, endMs: Math.max(0, Math.round(sec * 1000)), lengthSec: sec - open.sec })
      open = null
    }
  }
  // Source ended while still silent — close the final span at the duration.
  if (open !== null && durationMs > open.ms) {
    spans.push({ startMs: open.ms, endMs: durationMs, lengthSec: durationMs / 1000 - open.sec })
  }
  return spans
}

/** Whether a span is at least `ms` long as ffmpeg's own `d=` reads it: on its
 *  measured length, to the microsecond it prints — never on the rounded edges,
 *  which can make a span 0.06 ms short of the minimum read as long enough. */
const atLeastMs = (s: TimedSilence, ms: number) => s.lengthSec * 1000 + 1e-3 >= ms

/** Each span shrunk inward by `padMs` at both ends; a span that vanishes (or inverts) is dropped. */
function padSilences(spans: readonly SilenceRange[], padMs: number): SilenceRange[] {
  const pad = Math.max(0, Math.round(padMs))
  const out: SilenceRange[] = []
  for (const s of spans) {
    const startMs = s.startMs + pad
    const endMs = s.endMs - pad
    if (endMs > startMs) out.push({ startMs, endMs })
  }
  return out
}

export { ALL_RANGES_MIN_FLOOR_MS }

/** `allRangesMinMs` as a whole-ms length of at least ALL_RANGES_MIN_FLOOR_MS;
 *  absent (no list) for anything but a finite number or a numeric string, so a
 *  bad value never reaches ffmpeg's `d=`. */
function allRangesFloorMs(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
  return Number.isFinite(n) ? Math.max(ALL_RANGES_MIN_FLOOR_MS, Math.round(n)) : undefined
}

/**
 * Run one `silencedetect` pass over a LOCAL media file and return the padded
 * ranges (+ the unpadded `allRanges` when `allRangesMinMs` is set) and the
 * file's duration. Real ffmpeg; no network. This is the unit the lavfi e2e
 * test drives directly.
 */
export async function runSilenceDetectOnFile(
  localPath: string,
  settings: SilenceDetectSettings = SILENCE_DETECT_DEFAULTS,
  timeoutMs?: number,
): Promise<SilenceDetectResult> {
  const noiseDb = -Math.abs(settings.thresholdDb) // guard: always a cut BELOW 0 dBFS
  // Mirror the route Zod (`int().min(1)`): a workflow JSON / import can carry a
  // negative or fractional minSilenceMs the config-panel slider never produces,
  // and a negative `d=` makes ffmpeg error. Coerce-not-reject so the DAG path
  // yields the same result as single-node "Run from here" (not a silent empty).
  const minMs = Math.max(1, Math.round(settings.minSilenceMs ?? SILENCE_DETECT_DEFAULTS.minSilenceMs))
  const allMinMs = allRangesFloorMs(settings.allRangesMinMs)
  // One pass finds both lists: ffmpeg reports each silence at its true start
  // whatever the minimum, so the longer ones are the same spans either way.
  const durationSec = (allMinMs === undefined ? minMs : Math.min(minMs, allMinMs)) / 1000

  let stderr = ""
  try {
    const res = await runFfmpegCapture(
      [
        "-hide_banner", "-nostats",
        "-i", localPath,
        "-af", `silencedetect=noise=${noiseDb}dB:d=${durationSec}`,
        "-f", "null", "-",
      ],
      timeoutMs,
    )
    stderr = res.stderr
  } catch (err) {
    // `-f null -` normally exits 0, but keep the fallback the beat-grid path
    // uses: runFfmpegCapture attaches the full stderr to the thrown error, and
    // the markers we need are on it even when ffmpeg exits non-zero.
    // Only trust the non-zero-exit fallback when the marker lines are actually
    // present. A genuine ffmpeg failure (bad args, unreadable input) has NO
    // silence_* lines and must PROPAGATE — never masquerade as "0 silences
    // detected", which would commit a credit for a wrong empty result.
    // Nor is a pass that was stopped (killed, timed out) or whose log was cut
    // short (`truncated`: past the capture's buffer) a whole one: its last
    // silence_start would be closed at the end of the file, a "silence" over
    // everything after it, and a plan would cut all of that.
    const e = err as { stderr?: string; killed?: boolean; timedOut?: boolean; truncated?: boolean }
    if (!e?.stderr || !/silence_(start|end)/.test(e.stderr) || e.killed || e.timedOut || e.truncated) throw err
    stderr = e.stderr
  }

  const durationMs = Math.round((await probeMediaDuration(localPath)) * 1000)
  if (allMinMs === undefined) {
    const ranges = parseSilenceRanges(stderr, { padMs: settings.padMs, durationMs })
    return { version: SILENCE_DETECT_VERSION, ranges, durationMs }
  }
  const spans = parseTimedSilences(stderr, durationMs)
  const ranges = padSilences(spans.filter((s) => atLeastMs(s, minMs)), settings.padMs)
  const allRanges = spans.filter((s) => atLeastMs(s, allMinMs)).map(({ startMs, endMs }) => ({ startMs, endMs }))
  return { version: SILENCE_DETECT_VERSION, ranges, allRanges, durationMs }
}

/**
 * Detect silence in a remote audio/video source. Fetches (or reuses) the cached
 * 16 kHz mono audio proxy, downloads that small proxy locally, and runs one
 * `silencedetect` pass over it. Called from the video worker under the shared
 * ffmpeg slot (via `runFfmpegCapture`).
 */
export async function detectSilence(
  sourceUrl: string,
  settings: SilenceDetectSettings = SILENCE_DETECT_DEFAULTS,
): Promise<SilenceDetectResult> {
  const proxy = await ensureMediaProxy(sourceUrl, "audio")
  const workDir = await createWorkDir("silence-detect")
  try {
    const local = join(workDir, "proxy.m4a")
    // A hard total at the number its liveness budget charges for this fetch
    // (the proxy is small 16 kHz mono audio, read from our storage in seconds).
    await downloadFile(proxy.url, local, { timeoutMs: DOWNLOAD_TIMEOUT_MS })
    return await runSilenceDetectOnFile(local, settings)
  } finally {
    await cleanupWorkDir(workDir)
  }
}
