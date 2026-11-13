/**
 * Nemotron 3.5 Transcribe pricing — per STARTED minute of the file (decided
 * 2026-11-12): the same price with word timings or a translation.
 *
 * The base price is 0.75 credits a minute, which no whole-credit row can hold
 * (`model_pricing.credit_cost` is an integer), so the rate row prices FOUR
 * minutes — the same trick as Nodaro Video Upscale's four-second rows. A run
 * reserves `nemotron-3-5-transcribe:<N>m` (N = started minutes, 1..60), which
 * billing prices as that row × N ÷ 4, rounded up once for the whole run, then
 * marked up once — never a row of its own, so a retune of the rate row moves
 * the route, the workflow run, the node's Run button and every estimate
 * together. The same id is built by the route (from the probed length), the
 * workflow run (the same probe) and the editor (the upstream length it knows).
 * That id is the HOLD: a run is then CHARGED for the minutes the provider
 * reports it decoded, up or down (decided 2026-11-12; backend
 * `lib/nemotron-transcribe-settle.ts`).
 *
 * Worked base prices at the row's launch value of 3 (per 4 minutes):
 *   0:45 → 1,  1:00 → 1,  1:01 → 2,  10:00 → 8,  60:00 → 45.
 * The listed (marked-up) price follows from those.
 */

/** The engine's id — the Transcribe node's `provider`, and the bare price id. */
export const NEMOTRON_TRANSCRIBE_ID = "nemotron-3-5-transcribe"

export const NEMOTRON_TRANSCRIBE_PRICING = {
  /** The rate row: credits per {@link NEMOTRON_TRANSCRIBE_PRICING.RATE_MINUTES} minutes. Never reserved by itself. */
  RATE_CREDIT_ID: "nemotron-3-5-transcribe:per-4m",
  /** The minutes the rate row prices. */
  RATE_MINUTES: 4,
  /** The rate row's launch value (admin-retunable in /admin/models): 0.75 base credits a minute. */
  CREDITS_PER_RATE_DEFAULT: 3,
  /** The longest file a run accepts, in seconds (KIE's 60-minute limit; the route refuses longer). */
  MAX_DURATION_SEC: 3600,
  /** The most minutes a `nemotron-3-5-transcribe:<N>m` id can carry. */
  MAX_MINUTES: 60,
  /** The largest file a run accepts, in bytes (KIE's 200 MB limit). */
  MAX_BYTES: 200 * 1024 * 1024,
} as const

/**
 * Started minutes of a file of `durationSec` seconds: ceil(sec / 60), at least
 * 1, at most 60. An unknown or non-positive length counts as one minute here; a
 * quote of an unknown length names 60 instead ({@link nemotronTranscribeQuoteCreditId}),
 * as does a run whose file's length cannot be read (it holds 60 minutes and
 * settles at the provider's decoded length).
 */
export function nemotronTranscribeStartedMinutes(durationSec: number | null | undefined): number {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return 1
  return Math.min(NEMOTRON_TRANSCRIBE_PRICING.MAX_MINUTES, Math.max(1, Math.ceil(durationSec / 60)))
}

/** `nemotron-3-5-transcribe:<N>m` — the id a run on a file of `durationSec` seconds reserves. */
export function nemotronTranscribeCreditId(durationSec: number | null | undefined): string {
  return `${NEMOTRON_TRANSCRIBE_ID}:${nemotronTranscribeStartedMinutes(durationSec)}m`
}

/**
 * The id a QUOTE names for a file of `durationSec` seconds — every estimate
 * before a run. A known length is the id its run reserves. An UNKNOWN length is
 * the 60-minute id: a run measures the file before it reserves, holds 60
 * minutes for one whose length cannot be read and refuses one over 60 minutes,
 * and the provider refuses longer audio, so 60 minutes is the most any run can
 * be charged and the quote is never below the charge (Pitch & Tempo's rule).
 */
export function nemotronTranscribeQuoteCreditId(durationSec: number | null | undefined): string {
  const known = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
  return nemotronTranscribeCreditId(known ? durationSec : NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
}

/** The minutes of a `nemotron-3-5-transcribe:<N>m` id (1 ≤ N ≤ 60), or `undefined` for any other id. */
export function parseNemotronTranscribeCreditId(id: string): { minutes: number } | undefined {
  const m = /^nemotron-3-5-transcribe:(\d+)m$/.exec(id)
  if (!m) return undefined
  const minutes = Number(m[1])
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > NEMOTRON_TRANSCRIBE_PRICING.MAX_MINUTES) return undefined
  return { minutes }
}

/**
 * The base of a run of `minutes` started minutes from the rate row's value
 * (`ratePerBlock` credits per {@link NEMOTRON_TRANSCRIBE_PRICING.RATE_MINUTES}
 * minutes): rate × minutes ÷ 4, rounded up once for the whole run, at least 1.
 */
export function nemotronTranscribeBaseCredits(ratePerBlock: number, minutes: number): number {
  return Math.max(1, Math.ceil((ratePerBlock * minutes) / NEMOTRON_TRANSCRIBE_PRICING.RATE_MINUTES))
}
