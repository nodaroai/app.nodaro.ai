import type { AudioMetrics, ImageMetrics, Metrics, VideoMetrics } from "./measure.js"

/**
 * Tolerance-aware golden comparison.
 *
 * TOLERANCES ARE THE PRODUCT — get them wrong and the harness is worthless:
 * too tight and codec/resampler noise makes it cry wolf (everyone learns to
 * ignore it); too loose and it misses the 6 dB afir change it exists to
 * catch. Defaults follow the calibration below; individual operations may
 * override per metric (documented at the operation).
 *
 *  - energy/peak ±0.5 dB — catches the ×2 afir gain (6 dB) and ~1 dB reverb
 *    drift with 10× headroom, survives resample/codec noise.
 *  - duration ±1 ms — timing is exact; anything longer is a real change.
 *  - bands ±0.75 dB, with a relevance floor: bands ≥45 dB below the loudest
 *    band are codec-noise-dominated for narrowband fixtures (a sine occupies
 *    one band; the rest is shaped quantization noise), so both-quiet bands
 *    are not compared.
 *  - envelope ±1.0 dB per 50 ms window, floored at −60 dB absolute (silence)
 *    AND at 35 dB below the loudest golden window (relative). The relative
 *    floor exists because lossy encoders take CPU-feature-dispatched SIMD
 *    paths: the same binary on two machines produces slightly different
 *    encoded bits, and in QUIET tail windows that quantization noise is a
 *    ~2 dB swing (observed: the same pinned ffmpeg rendered
 *    combine-videos-fade's fade-out tail 1.98 dB apart on an emulated-amd64
 *    dev box vs a GitHub runner, while every loud window agreed). Windows
 *    that far under peak are codec noise, not DSP signal — the changes this
 *    harness exists to catch (a 6 dB afir gain step, reverb-time changes)
 *    all move windows at or within ~35 dB of the loudest one.
 *  - mean luma ±1 % of full scale (2.55 of 255); per-frame luma gets 2× that
 *    (single frames are noisier than the mean; the per-frame series is a
 *    geometry/timing fingerprint, not a radiometric assertion).
 */
export interface Tolerances {
  readonly energyDb: number
  readonly peakDb: number
  readonly bandDb: number
  readonly envelopeDb: number
  readonly durationMs: number
  readonly lumaPct: number
  readonly frames: number
}

export const DEFAULT_TOLERANCES: Tolerances = {
  energyDb: 0.5,
  peakDb: 0.5,
  bandDb: 0.75,
  envelopeDb: 1.0,
  durationMs: 1,
  lumaPct: 1,
  frames: 1,
}

const ENVELOPE_FLOOR_DB = -60
const ENVELOPE_RELEVANCE_DB = 35
const BAND_RELEVANCE_DB = 45
const LUMA_FULL_SCALE = 255

function diffNum(
  failures: string[],
  path: string,
  golden: number,
  actual: number,
  tol: number,
): void {
  const delta = Math.abs(golden - actual)
  if (delta > tol) {
    failures.push(
      `${path}: golden ${golden} vs actual ${actual} (Δ ${delta.toFixed(3)} > tol ${tol})`,
    )
  }
}

function diffExact(failures: string[], path: string, golden: unknown, actual: unknown): void {
  if (golden !== actual) {
    failures.push(`${path}: golden ${String(golden)} vs actual ${String(actual)} (must match exactly)`)
  }
}

function compareAudio(
  failures: string[],
  prefix: string,
  golden: AudioMetrics,
  actual: AudioMetrics,
  tol: Tolerances,
): void {
  diffExact(failures, `${prefix}sampleRate`, golden.sampleRate, actual.sampleRate)
  diffExact(failures, `${prefix}channels`, golden.channels, actual.channels)

  const samplesPerMs = golden.sampleRate / 1000
  diffNum(
    failures,
    `${prefix}durationSamples`,
    golden.durationSamples,
    actual.durationSamples,
    Math.ceil(tol.durationMs * samplesPerMs),
  )
  diffNum(failures, `${prefix}energyDb`, golden.energyDb, actual.energyDb, tol.energyDb)
  diffNum(failures, `${prefix}peakDb`, golden.peakDb, actual.peakDb, tol.peakDb)

  diffExact(failures, `${prefix}bandsDb.length`, golden.bandsDb.length, actual.bandsDb.length)
  const loudest = Math.max(...golden.bandsDb)
  for (let i = 0; i < Math.min(golden.bandsDb.length, actual.bandsDb.length); i++) {
    const g = golden.bandsDb[i]
    const a = actual.bandsDb[i]
    // Both sides deep under the loudest band → codec-noise floor, skip.
    if (g < loudest - BAND_RELEVANCE_DB && a < loudest - BAND_RELEVANCE_DB) continue
    diffNum(failures, `${prefix}bandsDb[${i}]`, g, a, tol.bandDb)
  }

  const windowLenTol = 1 + Math.ceil(tol.durationMs / 50)
  if (Math.abs(golden.envelopeDb.length - actual.envelopeDb.length) > windowLenTol) {
    failures.push(
      `${prefix}envelopeDb.length: golden ${golden.envelopeDb.length} vs actual ${actual.envelopeDb.length}`,
    )
  }
  const loudestWindow = Math.max(...golden.envelopeDb)
  const envelopeFloor = Math.max(ENVELOPE_FLOOR_DB, loudestWindow - ENVELOPE_RELEVANCE_DB)
  for (let i = 0; i < Math.min(golden.envelopeDb.length, actual.envelopeDb.length); i++) {
    const g = golden.envelopeDb[i]
    const a = actual.envelopeDb[i]
    // Both sides under the floor → silence or codec-noise tail, skip.
    if (g < envelopeFloor && a < envelopeFloor) continue
    diffNum(
      failures,
      `${prefix}envelopeDb[${i}]`,
      Math.max(envelopeFloor, g),
      Math.max(envelopeFloor, a),
      tol.envelopeDb,
    )
  }
}

function compareVideo(
  failures: string[],
  golden: VideoMetrics,
  actual: VideoMetrics,
  tol: Tolerances,
): void {
  diffExact(failures, "width", golden.width, actual.width)
  diffExact(failures, "height", golden.height, actual.height)
  diffExact(failures, "pixFmt", golden.pixFmt, actual.pixFmt)
  diffNum(failures, "fps", golden.fps, actual.fps, 0.01)
  diffNum(failures, "frames", golden.frames, actual.frames, tol.frames)

  const lumaTol = (tol.lumaPct / 100) * LUMA_FULL_SCALE
  diffNum(failures, "meanLuma", golden.meanLuma, actual.meanLuma, lumaTol)
  for (let i = 0; i < Math.min(golden.lumaPerFrame.length, actual.lumaPerFrame.length); i++) {
    diffNum(failures, `lumaPerFrame[${i}]`, golden.lumaPerFrame[i], actual.lumaPerFrame[i], lumaTol * 2)
  }

  if (golden.audio && actual.audio) {
    compareAudio(failures, "audio.", golden.audio, actual.audio, tol)
  } else if (Boolean(golden.audio) !== Boolean(actual.audio)) {
    failures.push(
      `audio stream presence: golden ${golden.audio ? "present" : "absent"} vs actual ${actual.audio ? "present" : "absent"}`,
    )
  }
}

function compareImage(failures: string[], golden: ImageMetrics, actual: ImageMetrics, tol: Tolerances): void {
  diffExact(failures, "width", golden.width, actual.width)
  diffExact(failures, "height", golden.height, actual.height)
  diffNum(failures, "meanLuma", golden.meanLuma, actual.meanLuma, (tol.lumaPct / 100) * LUMA_FULL_SCALE)
}

/** Compare measured metrics against the golden record. Returns human-readable
 *  failure lines; empty array = within tolerance. */
export function compareMetrics(
  golden: Metrics,
  actual: Metrics,
  overrides?: Partial<Tolerances>,
): string[] {
  const tol: Tolerances = { ...DEFAULT_TOLERANCES, ...overrides }
  const failures: string[] = []

  if (golden.kind !== actual.kind) {
    return [`kind: golden ${golden.kind} vs actual ${actual.kind}`]
  }
  if (golden.kind === "audio") compareAudio(failures, "", golden, actual as AudioMetrics, tol)
  else if (golden.kind === "video") compareVideo(failures, golden, actual as VideoMetrics, tol)
  else compareImage(failures, golden, actual as ImageMetrics, tol)

  return failures
}
