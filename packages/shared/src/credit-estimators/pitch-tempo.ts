/**
 * Pitch & Tempo pricing — per STARTED minute of the input media (decided
 * 2026-10-12), at least one minute, at most 30.
 *
 * One `model_pricing` row, `pitch-tempo`, holds the credits per minute; a run
 * reserves `pitch-tempo:<N>m` (N = started minutes), which billing prices as
 * that row × N — never a row of its own, so a retune of the rate row moves the
 * route, the workflow run, the node's Run button and every estimate together.
 * The same id is built by the route (from the probed length), the workflow run
 * (the same probe) and the editor (the upstream length it knows).
 *
 * Worked examples at the row's listed rate of 20 (repeated in
 * docs/nodes/processing-audio/pitch-tempo.md):
 *   0:45 → 20,  1:00 → 20,  1:01 → 40,  3:10 → 80,  30:00 → 600.
 */

export const PITCH_TEMPO_PRICING = {
  /** The rate row: credits per started minute. Never reserved by itself. */
  RATE_CREDIT_ID: "pitch-tempo",
  /** The longest input a run accepts, in seconds (the route refuses longer). */
  MAX_DURATION_SEC: 1800,
  /** The most minutes a `pitch-tempo:<N>m` id can carry. */
  MAX_MINUTES: 30,
  /** The rate row's launch value (admin-retunable in /admin/models). */
  CREDITS_PER_MINUTE_DEFAULT: 20,
} as const

/** The control ranges every surface validates against. */
export const PITCH_TEMPO_LIMITS = {
  SEMITONES_MIN: -12,
  SEMITONES_MAX: 12,
  TEMPO_MIN: 0.5,
  TEMPO_MAX: 2,
} as const

/**
 * Started minutes of an input of `durationSec` seconds: ceil(sec / 60), at
 * least 1, at most 30. An unknown or non-positive length counts as one minute
 * here; a quote of an unknown length names 30 instead
 * ({@link pitchTempoQuoteCreditId}), and a run always measures.
 */
export function pitchTempoStartedMinutes(durationSec: number | null | undefined): number {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return 1
  return Math.min(PITCH_TEMPO_PRICING.MAX_MINUTES, Math.max(1, Math.ceil(durationSec / 60)))
}

/** `pitch-tempo:<N>m` — the id a run on an input of `durationSec` seconds reserves. */
export function pitchTempoCreditId(durationSec: number | null | undefined): string {
  return `pitch-tempo:${pitchTempoStartedMinutes(durationSec)}m`
}

/**
 * The id a QUOTE names for an input of `durationSec` seconds — every estimate
 * before a run. A known length is the id its run reserves
 * ({@link pitchTempoCreditId}). An UNKNOWN length is the 30-minute id
 * (decided 2026-10-13): a run measures the file before it reserves and refuses
 * one it cannot measure or one over 30 minutes, so 30 minutes is the most any
 * run can be charged and the quote is never below the charge.
 */
export function pitchTempoQuoteCreditId(durationSec: number | null | undefined): string {
  const known = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
  return pitchTempoCreditId(known ? durationSec : PITCH_TEMPO_PRICING.MAX_DURATION_SEC)
}

/** The minutes of a `pitch-tempo:<N>m` id (1 ≤ N ≤ 30), or `undefined` for any other id. */
export function parsePitchTempoCreditId(id: string): { minutes: number } | undefined {
  const m = /^pitch-tempo:(\d+)m$/.exec(id)
  if (!m) return undefined
  const minutes = Number(m[1])
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > PITCH_TEMPO_PRICING.MAX_MINUTES) return undefined
  return { minutes }
}

/** rate × minutes, rounded up, at least 1 credit — what a `pitch-tempo:<N>m` id costs. */
export function pitchTempoBaseCredits(ratePerMinute: number, minutes: number): number {
  return Math.max(1, Math.ceil(ratePerMinute * minutes))
}

/** The frequency ratio for a shift of `semitones` (12 = one octave up = ×2). */
export function semitonesToPitchRatio(semitones: number): number {
  return 2 ** (semitones / 12)
}
