/**
 * Add Captions transcribing on Nemotron 3.5 Transcribe — ONE charge for the
 * render and its transcription (decided 2026-11-13).
 *
 * Every Add Captions render that transcribes is a Remotion render
 * (`captionRoutesToRemotion`), billed at the kinetic row. On the other engines
 * that flat row covers the transcription too. Nemotron is priced by the
 * video's length, so its caption run holds
 * `add-captions:kinetic:nemotron:<N>m` (N = started minutes of the video,
 * 1..60): the kinetic row plus Nemotron's own per-minute price (its four-minute
 * rate row × N ÷ 4, rounded up once), summed into one base and marked up once
 * — never a row of its own, so a retune of either row moves every price
 * together. The id keeps the `add-captions` prefix, so Add Captions' margin
 * applies to the whole charge.
 *
 * It is held only when a transcription will actually run on Nemotron; a
 * Nemotron node that brings its own captions, transcript or static text holds
 * the plain kinetic row. Like the Transcribe node's id it is the HOLD: the run
 * is charged for the minutes the provider reports it decoded, up or down
 * (backend `lib/nemotron-transcribe-settle.ts`).
 */
import {
  NEMOTRON_TRANSCRIBE_PRICING,
  nemotronTranscribeBaseCredits,
  nemotronTranscribeStartedMinutes,
} from "./nemotron-transcribe.js"

/** The Remotion render's row — every Add Captions render that transcribes. */
export const ADD_CAPTIONS_KINETIC_CREDIT_ID = "add-captions:kinetic"

/** The prefix of the per-minute ids a Nemotron caption run holds. */
export const ADD_CAPTIONS_NEMOTRON_ID_PREFIX = `${ADD_CAPTIONS_KINETIC_CREDIT_ID}:nemotron`

/** `add-captions:kinetic:nemotron:<N>m` for N started minutes (1..60, clamped). */
export function addCaptionsNemotronMinutesId(minutes: number): string {
  const n = Math.min(NEMOTRON_TRANSCRIBE_PRICING.MAX_MINUTES, Math.max(1, Math.ceil(minutes)))
  return `${ADD_CAPTIONS_NEMOTRON_ID_PREFIX}:${n}m`
}

/** The id a Nemotron caption run on a video of `durationSec` seconds holds (its started minutes). */
export function addCaptionsNemotronCreditId(durationSec: number | null | undefined): string {
  return addCaptionsNemotronMinutesId(nemotronTranscribeStartedMinutes(durationSec))
}

/**
 * The id a QUOTE names for a video of `durationSec` seconds — every estimate
 * before a run. A known length is the id its run holds; an UNKNOWN length is
 * the 60-minute id, the most any run can be charged (a run measures the video
 * first, holds 60 minutes for one whose length cannot be read, and refuses one
 * over 60 minutes).
 */
export function addCaptionsNemotronQuoteCreditId(durationSec: number | null | undefined): string {
  const known = typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
  return addCaptionsNemotronCreditId(known ? durationSec : NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
}

/** The minutes of an `add-captions:kinetic:nemotron:<N>m` id (1 ≤ N ≤ 60), or `undefined` for any other id. */
export function parseAddCaptionsNemotronCreditId(id: string): { minutes: number } | undefined {
  const m = /^add-captions:kinetic:nemotron:(\d+)m$/.exec(id)
  if (!m) return undefined
  const minutes = Number(m[1])
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > NEMOTRON_TRANSCRIBE_PRICING.MAX_MINUTES) return undefined
  return { minutes }
}

/**
 * The base of a Nemotron caption run of `minutes` started minutes: the kinetic
 * row's base plus Nemotron's per-minute base for those minutes (`ratePerBlock`
 * credits per four minutes, rounded up once). Marked up once, as one charge.
 */
export function addCaptionsNemotronBaseCredits(kineticBase: number, ratePerBlock: number, minutes: number): number {
  return kineticBase + nemotronTranscribeBaseCredits(ratePerBlock, minutes)
}
