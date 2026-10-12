/**
 * Split into Chunks (`split-media`) — the part plan, the refusals and the
 * budgets, PURE (no ffmpeg, no storage, no config). Imports only `@nodaro/render-rules`
 * and the two pure budget leaves, so the job-budget registry (read by the
 * workflow engine) can reach `splitMediaJobBudgetMs` without loading the ffmpeg
 * runtime (`lib/__tests__/job-budget-leaf.test.ts`). `split-media.ts` renders
 * from these and re-exports them.
 *
 * THE RULE (product decision, 2026-10-12). Every part's length lies in
 * [min, x] — never longer than the part length x (`chunkDuration`), never
 * shorter than the minimum (`minPartDuration`, default
 * `SPLIT_MEDIA_DEFAULT_MIN_PART_SEC`, never above x). Lengths are counted in
 * whole UNITS — frames of the constant-rate picture for a video, samples for an
 * audio file — and every conversion between a time and a unit count is integer
 * arithmetic on whole milliseconds with the rate held as a fraction (BigInt in
 * between), never `Math.round(seconds * fps)`:
 *   maxUnits = ⌊xMs · num / (1000 · den)⌋   (a part never runs past x)
 *   minUnits = ⌈minMs · num / (1000 · den)⌉ (a part never falls short of min)
 * x = 10 s at 30000/1001 → 299 frames, at 30/1 → 300, at 25/1 → 250.
 */
import { SPLIT_MEDIA_MAX_PARTS, SPLIT_MEDIA_MAX_SOURCE_SEC, splitMediaMinPartSec } from "@nodaro/render-rules"
import { DEFAULT_FFMPEG_TIMEOUT_MS, DOWNLOAD_MAX_MS, FFPROBE_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import {
  CHUNK_RENDER_MARGIN,
  CHUNK_RENDER_SECS_PER_OUTPUT_SEC,
  CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC,
  LIVENESS_CANVAS,
  canvasPixelFactor,
  type RenderCanvas,
} from "./apply-edl-budget.js"

export { SPLIT_MEDIA_MAX_PARTS, SPLIT_MEDIA_MAX_SOURCE_SEC }

/** A unit rate as a fraction: `num / den` units (frames or samples) per second. */
export interface UnitRate {
  readonly num: number
  readonly den: number
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/** A rate as a reduced fraction; refuses anything that is not a positive integer fraction. */
export function unitRate(num: number, den = 1): UnitRate {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
    throw new RangeError(`rate ${num}/${den} is not a positive integer fraction`)
  }
  const g = Number(gcd(BigInt(num), BigInt(den)))
  return { num: num / g, den: den / g }
}

/** The part length in whole milliseconds, rounded DOWN (a part may not run past it).
 *  The epsilon absorbs binary float noise (2.3 s is 2299.9999… ms). */
export const maxPartMsOf = (sec: number): number => Math.floor(sec * 1000 + 1e-6)

/** The minimum part length in whole milliseconds, rounded UP (a part may not fall short of it). */
export const minPartMsOf = (sec: number): number => Math.max(0, Math.ceil(sec * 1000 - 1e-6))

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b

/** The most whole units that fit in `ms`: ⌊ms · num / (1000 · den)⌋. */
export function unitsAtMost(ms: number, rate: UnitRate): number {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`${ms} ms is not a whole, non-negative millisecond count`)
  return Number((BigInt(ms) * BigInt(rate.num)) / (1000n * BigInt(rate.den)))
}

/** The fewest whole units that last at least `ms`: ⌈ms · num / (1000 · den)⌉. */
export function unitsAtLeast(ms: number, rate: UnitRate): number {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`${ms} ms is not a whole, non-negative millisecond count`)
  return Number(ceilDiv(BigInt(ms) * BigInt(rate.num), 1000n * BigInt(rate.den)))
}

/** The nearest whole unit to `ms` (half up) — for ESTIMATES only (a probed duration), never a cut. */
export function unitsNearest(ms: number, rate: UnitRate): number {
  const n = BigInt(Math.max(0, Math.round(ms))) * BigInt(rate.num)
  const d = 1000n * BigInt(rate.den)
  return Number((2n * n + d) / (2n * d))
}

/** Seconds that `units` units last, as a number (for reports: `partDurationsSec`). */
export const unitsToSec = (units: number, rate: UnitRate): number => (units * rate.den) / rate.num

/**
 * THE partition: `totalUnits` cut into the FEWEST parts of at most `maxUnits`
 * (n = ⌈total / max⌉), each at least `minUnits`. The first n − 1 parts are
 * exactly `maxUnits` and the last holds the remainder — unless the remainder is
 * under `minUnits`, when the LAST j parts (the smallest j ≥ 2 that works) share
 * what they hold between them as evenly as possible: sizes differ by at most one
 * unit, the larger ones FIRST. Every part stays ≤ `maxUnits` by construction.
 *
 * 1798 frames, max 299, min 120 → 299 × 5, 152, 151.
 *
 * Returns `null` when no partition into n parts can keep every part ≥ min
 * (n · min > total — a source shorter than the minimum included). The part
 * COUNT is always n = ⌈total / max⌉; the caller applies the
 * `SPLIT_MEDIA_MAX_PARTS` cap to it.
 */
export function planSplitParts(totalUnits: number, maxUnits: number, minUnits: number): number[] | null {
  for (const [name, v] of [["totalUnits", totalUnits], ["maxUnits", maxUnits], ["minUnits", minUnits]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`${name} ${v} is not a whole, non-negative count`)
  }
  if (maxUnits < 1) throw new RangeError("maxUnits must be at least 1")
  if (totalUnits < 1) return null
  const n = Math.ceil(totalUnits / maxUnits)
  if (n * minUnits > totalUnits) return null
  const last = totalUnits - (n - 1) * maxUnits
  if (last >= minUnits) return [...Array<number>(n - 1).fill(maxUnits), last]
  for (let j = 2; j <= n; j++) {
    const shared = totalUnits - (n - j) * maxUnits
    const q = Math.floor(shared / j)
    if (q < minUnits) continue
    const r = shared % j
    const tail = Array.from({ length: j }, (_, i) => (i < r ? q + 1 : q))
    return [...Array<number>(n - j).fill(maxUnits), ...tail]
  }
  return null
}

/** The cumulative cut points of a partition: [0, p0, p0 + p1, …, total]. */
export function cutPointsOf(parts: readonly number[]): number[] {
  const cuts = [0]
  for (const p of parts) cuts.push(cuts[cuts.length - 1]! + p)
  return cuts
}

/**
 * The audio samples that go with picture frames [f0, f1): samples
 * [⌈f0 · den · sr / num⌉, ⌊f1 · den · sr / num⌋). Rounding the start up and the
 * end down keeps every part's sound within its picture — never longer — at the
 * cost of at most one sample dropped at a seam.
 */
export function audioSamplesForFrames(f0: number, f1: number, fps: UnitRate, sampleRate: number): { start: number; end: number } {
  const num = BigInt(fps.num)
  const k = BigInt(fps.den) * BigInt(sampleRate)
  return { start: Number(ceilDiv(BigInt(f0) * k, num)), end: Number((BigInt(f1) * k) / num) }
}

/** Samples in one AAC frame (packet). */
export const AAC_FRAME_SAMPLES = 1024

/**
 * The length a video part's AAC sound is written at: its window rounded DOWN
 * to whole AAC frames. Measured 2026-10-12: the pinned ffmpeg (n8.1.2) decodes
 * an AAC track in MP4 to whole frames — it skips the priming the edit list
 * names but not the padding at the end — so N samples decode to ⌈N / 1024⌉ ·
 * 1024 there (57 600 → 58 368: past the picture), while a decoder that honours
 * the edit list's end (ffmpeg 9, the MP4 spec) gives N. A multiple of 1024
 * decodes to exactly N on both (with the movie timescale at the sample rate,
 * below). The cost: up to 1 023 samples (21 ms at 48 kHz) of the window's end
 * are not in the part. 0 when the window is under one frame.
 */
export const aacWholeFrameSamples = (windowSamples: number): number =>
  Math.floor(Math.max(0, windowSamples) / AAC_FRAME_SAMPLES) * AAC_FRAME_SAMPLES

/** Frame `index`'s start time in whole MICROSECONDS, rounded DOWN — a forced
 *  keyframe time that lands on that frame and never the one after it (rounded
 *  up, 598 frames at 30000/1001 = 19.9532666… s became 19.953267 and ffmpeg
 *  keyed frame 599). */
export function frameStartMicros(index: number, fps: UnitRate): bigint {
  return (BigInt(index) * BigInt(fps.den) * 1_000_000n) / BigInt(fps.num)
}

/** `-force_key_frames` time list for these frame indices (seconds, 6 decimals). */
export function forcedKeyframeTimes(indices: readonly number[], fps: UnitRate): string {
  return indices
    .map((i) => {
      const us = frameStartMicros(i, fps)
      return `${us / 1_000_000n}.${(us % 1_000_000n).toString().padStart(6, "0")}`
    })
    .join(",")
}

/** How far the encoded frame count may sit from the probe's estimate and still
 *  find every cut already keyed: the estimate is the stream's duration × rate,
 *  and the constant-rate picture differs from it by a frame or so at most. */
export const FRAME_ESTIMATE_SLACK = 2

/**
 * Every frame index a cut can land on for ANY total within
 * `FRAME_ESTIMATE_SLACK` of the estimate (each feasible partition's cuts,
 * unioned). The encode keys all of them, so once the real frame count is known
 * its partition's cuts are keyframes and the parts are cut by stream copy.
 */
export function keyframeCandidates(estimatedFrames: number, maxUnits: number, minUnits: number): number[] {
  const out = new Set<number>([0])
  for (let t = Math.max(1, estimatedFrames - FRAME_ESTIMATE_SLACK); t <= estimatedFrames + FRAME_ESTIMATE_SLACK; t++) {
    const parts = planSplitParts(t, maxUnits, minUnits)
    if (!parts || parts.length > SPLIT_MEDIA_MAX_PARTS) continue
    for (const c of cutPointsOf(parts).slice(0, -1)) out.add(c)
  }
  return [...out].sort((a, b) => a - b)
}

// --- refusals -----------------------------------------------------------------

/** Seconds as people write them: up to two decimals, thousands separated. */
export function formatSec(sec: number): string {
  return sec.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

/** The shortest WHOLE-second part length that keeps `totalUnits` within the cap. */
export function minPartSecForCap(totalUnits: number, rate: UnitRate): number {
  const perPart = BigInt(Math.ceil(totalUnits / SPLIT_MEDIA_MAX_PARTS))
  const ms = ceilDiv(perPart * 1000n * BigInt(rate.den), BigInt(rate.num))
  return Number(ceilDiv(ms, 1000n))
}

export type SplitMediaKind = "video" | "audio"

/** What a split of `totalUnits` at these settings makes — the parts, or why it cannot. */
export type SplitPlanVerdict =
  | { readonly ok: true; readonly parts: number[] }
  | { readonly ok: false; readonly message: string }

/**
 * Plan a split, or say why not — the cap, the minimum, or a part length that
 * holds no whole frame. A pure function of the inputs, so a refusal is a
 * `DeterministicJobError` (failed and refunded once, never retried).
 */
export function planSplit(
  kind: SplitMediaKind,
  totalUnits: number,
  rate: UnitRate,
  chunkSec: number,
  minPartSec: number,
): SplitPlanVerdict {
  const maxUnits = unitsAtMost(maxPartMsOf(chunkSec), rate)
  const minUnits = unitsAtLeast(minPartMsOf(minPartSec), rate)
  const lengthSec = unitsToSec(totalUnits, rate)
  if (maxUnits < 1) {
    const fps = rate.num / rate.den
    return {
      ok: false,
      message: `This video runs at ${formatSec(fps)} fps, so a ${formatSec(chunkSec)} s part holds no whole frame. Use a part length of at least ${formatSec(Math.ceil(rate.den / rate.num))} s.`,
    }
  }
  if (totalUnits < 1) return { ok: false, message: `This ${kind} is empty — there is nothing to split.` }
  const n = Math.ceil(totalUnits / maxUnits)
  if (n > SPLIT_MEDIA_MAX_PARTS) {
    return {
      ok: false,
      message: `This ${kind} would make ${n.toLocaleString("en-US")} parts; the limit is ${SPLIT_MEDIA_MAX_PARTS}. Use a part length of at least ${formatSec(minPartSecForCap(totalUnits, rate))} s, or trim the ${kind} first.`,
    }
  }
  const parts = planSplitParts(totalUnits, maxUnits, minUnits)
  if (parts) return { ok: true, parts }
  if (totalUnits < minUnits) {
    return { ok: false, message: `This ${formatSec(lengthSec)} s ${kind} is shorter than the ${formatSec(minPartSec)} s minimum part length.` }
  }
  return {
    ok: false,
    message: `This ${formatSec(lengthSec)} s ${kind} can't be cut into parts between ${formatSec(minPartSec)} s and ${formatSec(chunkSec)} s — lower the minimum or raise the part length.`,
  }
}

/** A length as people say it: "3 h 12 min", "2 h 0 min 5 s", "45 s" — whole
 *  seconds, rounded UP so a source just past a limit never reads as on it. */
export function formatLength(sec: number): string {
  const total = Math.max(0, Math.ceil(sec - 1e-9))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const out: string[] = []
  if (h > 0) out.push(`${h} h`)
  if (h > 0 || m > 0) out.push(`${m} min`)
  if (s > 0 || out.length === 0) out.push(`${s} s`)
  if (h > 0 && s === 0 && m === 0) return `${h} h`
  return out.join(" ")
}

/** The most whole units of source a split takes: `SPLIT_MEDIA_MAX_SOURCE_SEC`
 *  (3 hours, decided 2026-10-12, like Apply EDL's 3-hour output cap) — it
 *  bounds the job's budget. */
export const maxSourceUnits = (rate: UnitRate): number => unitsAtMost(SPLIT_MEDIA_MAX_SOURCE_SEC * 1000, rate)

/** The refusal for a source past the 3-hour cap; `sec` undefined when the file
 *  stated no length (its decode stopped one unit past the cap). */
export function sourceTooLongMessage(kind: SplitMediaKind, sec: number | undefined): string {
  const limit = formatLength(SPLIT_MEDIA_MAX_SOURCE_SEC).replace(/^3 h$/, "3 hours")
  const length = sec === undefined ? `longer than ${limit}` : `${formatLength(sec)} long`
  return `This ${kind} is ${length}; Split into Chunks takes up to ${limit} — trim it first.`
}

/** The longest source one job can hold: 200 parts of x, and never past 3 hours. */
export const maxSourceSecFor = (chunkSec: number): number => Math.min(SPLIT_MEDIA_MAX_PARTS * chunkSec, SPLIT_MEDIA_MAX_SOURCE_SEC)

/** The refusal for a source whose length was not stated and turned out past
 *  the cap (the encode or decode stops one unit past it, so the true count is unknown). */
export function overCapOfUnknownLength(kind: SplitMediaKind, chunkSec: number): string {
  return `This ${kind} is longer than ${SPLIT_MEDIA_MAX_PARTS} parts of ${formatSec(chunkSec)} s; the limit is ${SPLIT_MEDIA_MAX_PARTS}. Use a longer part length, or trim the ${kind} first.`
}

/** The effective settings of a job: x and the minimum, or `undefined` for an unusable x. */
export function splitSettingsOf(data: { chunkDuration?: unknown; minPartDuration?: unknown }): { chunkSec: number; minPartSec: number } | undefined {
  const chunkSec = data.chunkDuration
  if (typeof chunkSec !== "number" || !Number.isFinite(chunkSec) || chunkSec <= 0) return undefined
  return { chunkSec, minPartSec: splitMediaMinPartSec(chunkSec, data.minPartDuration) }
}

// --- kill budgets ---------------------------------------------------------------

/** The constant-rate re-encode of the whole picture (decode + fps + x264, one
 *  pass): apply-edl's measured rates for a dense one-segment slice (encode per
 *  output second + decode per source second, by the canvas's pixel factor),
 *  with its margin — a straight re-encode is the lightest shape that measured. */
export function splitEncodeTimeoutMs(sourceSec: number, canvas: RenderCanvas): number {
  const perSec = (CHUNK_RENDER_SECS_PER_OUTPUT_SEC + CHUNK_RENDER_SECS_PER_VIDEO_SPAN_SEC) * canvasPixelFactor(canvas)
  return Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, Math.ceil(CHUNK_RENDER_MARGIN * perSec * Math.max(0, sourceSec) * 1000))
}

/** Seconds per source second of a stream copy or a PCM decode (I/O bound). */
export const SPLIT_COPY_SECS_PER_SEC = 0.05
/** Seconds per output second of one part's sound encode (AAC/MP3/WAV). */
export const SPLIT_AUDIO_SECS_PER_SEC = 0.1
/** The least any per-part step is given: the launch and finish on a busy box. */
export const SPLIT_PART_TIMEOUT_FLOOR_MS = 2 * 60_000

/** Cutting the encoded picture into its parts by stream copy, or decoding a sound file to PCM. */
export function splitCopyTimeoutMs(sourceSec: number): number {
  return Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, Math.ceil(CHUNK_RENDER_MARGIN * SPLIT_COPY_SECS_PER_SEC * Math.max(0, sourceSec) * 1000))
}

/** One part's finish: its picture copied (if any) and its sound encoded. */
export function splitPartTimeoutMs(partSec: number): number {
  const perSec = SPLIT_AUDIO_SECS_PER_SEC + SPLIT_COPY_SECS_PER_SEC
  return Math.max(SPLIT_PART_TIMEOUT_FLOOR_MS, Math.ceil(CHUNK_RENDER_MARGIN * perSec * Math.max(0, partSec) * 1000))
}

/**
 * The liveness budget of one split-media job — the sum of the kill budgets of
 * its bounded steps, in the order it runs them. The payload does not say how
 * long the source is, but two caps bound it: a split that passes has at most
 * `SPLIT_MEDIA_MAX_PARTS` parts of at most x, and its source is at most
 * `SPLIT_MEDIA_MAX_SOURCE_SEC` (3 hours) — so min(200 · x, 3 h)
 * (`maxSourceSecFor`); the picture is charged at `LIVENESS_CANVAS` (4K30), the
 * ceiling the kill budget's pixel factor stops at. Every part's finish is
 * counted for the most parts that source can make: min(200, ⌈source / x⌉ + 1)
 * (the + 1: parts round down to whole units, so a part is a frame under x).
 *
 *  - video: the big-media download, the probe, the encode, the frame count —
 *    twice (a frame count outside the estimate's slack re-encodes with the
 *    exact cuts), the copy cut, and every part's finish;
 *  - audio: the big-media download, the probe, the PCM decode, every part's encode.
 *
 * Storage I/O (the uploads) is outside it, as for every budget. `undefined`
 * (readers keep their defaults) when the payload names no source or no usable x.
 */
export function splitMediaJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as { videoUrl?: unknown; audioUrl?: unknown; chunkDuration?: unknown }
  const settings = splitSettingsOf(d)
  if (!settings) return undefined
  const hasVideo = typeof d.videoUrl === "string" && d.videoUrl.length > 0
  const hasAudio = typeof d.audioUrl === "string" && d.audioUrl.length > 0
  if (!hasVideo && !hasAudio) return undefined
  const maxSourceSec = maxSourceSecFor(settings.chunkSec)
  const partCount = Math.min(SPLIT_MEDIA_MAX_PARTS, Math.ceil(maxSourceSec / settings.chunkSec) + 1)
  const parts = partCount * splitPartTimeoutMs(settings.chunkSec)
  let ms = 0
  if (hasVideo) {
    ms += DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS
    ms += 2 * (splitEncodeTimeoutMs(maxSourceSec, LIVENESS_CANVAS) + FFPROBE_TIMEOUT_MS)
    ms += splitCopyTimeoutMs(maxSourceSec) + parts
  }
  if (hasAudio) {
    ms += DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + splitCopyTimeoutMs(maxSourceSec) + parts
  }
  return ms
}
