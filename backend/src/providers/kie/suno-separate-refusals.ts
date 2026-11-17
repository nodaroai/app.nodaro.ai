/**
 * Suno Separate — the refusals that depend only on the input, for BOTH lanes.
 *
 * The market lane (`suno-separate-market.ts`, `jobs/recordInfo`: `failCode` +
 * `failMsg`) and the old vocal-removal lane (`suno-client.ts`,
 * `vocal-removal/record-info`: `errorCode` + `errorMessage`) report the same
 * refusals in different fields. `separateFailure` is the one rule both read,
 * so a refused track fails with the same typed error whichever lane ran it:
 *   - code 413 / "matches an existing recording in our catalog" — Suno will
 *     not separate the audio (seen on the old lane as 413 "Uploaded audio
 *     contains copyrighted lyrics.", on a track Suno itself had generated);
 *   - "14-day retention period" — Suno could not fetch the audio.
 * Both are `DeterministicJobError`s: no queue retry, full refund. Their
 * message never carries the provider's ids or text; the provider's code and
 * words ride as the error's `cause`, for the failed job's operator detail.
 *
 * A leaf on purpose (it imports only the error base class), so the old-lane
 * client can use it without depending on the market lane's module.
 */

import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

// =============================================================================
// USER-FACING ERRORS
// =============================================================================

export const SUNO_CATALOG_REFUSAL_MESSAGE =
  "Suno recognised this as a commercially released recording and won't separate it. Use the Audio Separation node (Demucs), or turn on 'If Suno refuses, use Demucs'."

/** Catalog refusal in one-instrument mode, which has no Demucs fallback. */
export const SUNO_CATALOG_REFUSAL_SINGLE_MESSAGE =
  "Suno recognised this as a commercially released recording and won't separate it. One-instrument mode has no Demucs fallback — use the Audio Separation node for vocals or stems."

/**
 * Suno refused to separate one of its own tracks, sent by its ids (decided
 * 2026-11-17). Nothing here is a released recording, and there is no file to
 * hand to Demucs, so the sentence names neither. One-instrument mode ends
 * after the first sentence: Audio Separation cannot isolate a named instrument.
 */
export const SUNO_TRACK_REFUSAL_SINGLE_MESSAGE = "Suno won't separate this track."
export const SUNO_TRACK_REFUSAL_MESSAGE =
  `${SUNO_TRACK_REFUSAL_SINGLE_MESSAGE} Use the Audio Separation node (Demucs) instead.`

/**
 * Suno no longer holds the audio of one of its own tracks, sent by its ids
 * (decided 2026-11-17). There is no file for the user to check, so the
 * sentence says what happened to the track. One-instrument mode ends after
 * the first sentence, as the track refusal does.
 */
export const SUNO_TRACK_UNAVAILABLE_SINGLE_MESSAGE = "This Suno track is no longer available at Suno."
export const SUNO_TRACK_UNAVAILABLE_MESSAGE =
  `${SUNO_TRACK_UNAVAILABLE_SINGLE_MESSAGE} Use the Audio Separation node (Demucs) instead.`

export const SUNO_AUDIO_UNREACHABLE_MESSAGE =
  "Suno couldn't download this audio. Check the file is reachable, or use the Audio Separation node."

export const SUNO_INPUT_TOO_LARGE_MESSAGE =
  "Suno accepts audio up to 20 MB — trim it or use Audio Separation."

/** Suno refused to separate the audio as protected material (provider code 413). */
export class SunoCatalogRefusalError extends DeterministicJobError {
  readonly code = "suno_catalog_refusal" as const

  constructor(message: string = SUNO_CATALOG_REFUSAL_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoCatalogRefusalError"
  }
}

/** Suno could not download the audio it was asked to separate. */
export class SunoAudioUnreachableError extends DeterministicJobError {
  readonly code = "suno_audio_unreachable" as const

  constructor(message: string = SUNO_AUDIO_UNREACHABLE_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoAudioUnreachableError"
  }
}

/** The audio is over the market lane's input cap. */
export class SunoInputTooLargeError extends DeterministicJobError {
  readonly code = "suno_input_too_large" as const

  constructor(message: string = SUNO_INPUT_TOO_LARGE_MESSAGE, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SunoInputTooLargeError"
  }
}

// =============================================================================
// THE RULE
// =============================================================================

const CATALOG_REFUSAL_RE = /matches an existing recording/i
// KIE's text reads "The original song’s audio has expired after the 14-day
// retention period …" with a U+2019 apostrophe, so only this substring is matched.
const AUDIO_UNREACHABLE_RE = /14-day retention period/i

/**
 * The provider's own code and words, as the `cause` of a typed refusal. The
 * refusal's message stays ours; this is what the failed job keeps as its
 * operator-facing `error_detail` (`providerDetailOf` reads `internalDetails`
 * along the cause chain), so a refused run still says why on its row.
 */
function providerReason(failCode: string, failMsg: string): Error & { internalDetails: string } {
  const internalDetails = `Suno separate task failed: [${failCode}] ${failMsg}`
  return Object.assign(new Error(internalDetails), { internalDetails })
}

/**
 * A typed error for a refusal that depends only on the input; otherwise
 * `undefined`. `failCode` is the provider's code AS A STRING (the old lane
 * sends a number: its caller converts it). The error's `cause` carries the
 * provider's code and words (`providerReason`), on both lanes.
 */
export function separateFailure(failCode: string, failMsg: string): Error | undefined {
  if (failCode === "413" || CATALOG_REFUSAL_RE.test(failMsg)) {
    return new SunoCatalogRefusalError(undefined, { cause: providerReason(failCode, failMsg) })
  }
  if (AUDIO_UNREACHABLE_RE.test(failMsg)) {
    return new SunoAudioUnreachableError(undefined, { cause: providerReason(failCode, failMsg) })
  }
  return undefined
}
