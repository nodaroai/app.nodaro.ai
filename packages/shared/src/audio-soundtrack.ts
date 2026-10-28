import { hasFeature } from "./model-catalog.js"

/**
 * Audio soundtrack: a video model whose reference audio clips are VOICE samples
 * (catalog feature `voice-references`, Kling 4.0) cannot play a clip as it is —
 * but it keeps a reference VIDEO's own sound when asked (`keep_original_sound`).
 * A model declaring `audio-soundtrack` therefore plays the FIRST reference audio
 * clip as the result's soundtrack: the platform turns that clip into a short
 * reference video (one still frame carrying the audio) and sends it with the
 * video's sound kept, so the people in the scene perform to the exact track.
 * Any further clips stay voice samples.
 *
 * On by default (`audioSoundtrack` unset = on); a caller turns it off with
 * `audioSoundtrack: false`. The clip then IS a reference video everywhere a run
 * is checked or priced — the reference-video price, the 5-clip and 30-second
 * caps — because the request carries it as one before any of those run.
 */

/** The shortest reference video Kling 4.0 accepts; a shorter clip is padded with silence. */
export const AUDIO_SOUNDTRACK_MIN_SEC = 2

/** The soundtrack clip's frame rate: its length is a whole number of these frames. */
export const AUDIO_SOUNDTRACK_FPS = 24

/** Whether this run plays its first reference audio clip as the soundtrack. */
export function audioSoundtrackActive(args: {
  provider: string | undefined
  /** The node / request lever; unset = on. */
  audioSoundtrack: boolean | undefined
  /** How many reference audio clips the run carries (or has wired). */
  audioRefCount: number
}): boolean {
  return (
    !!args.provider &&
    hasFeature(args.provider, "audio-soundtrack") &&
    args.audioSoundtrack !== false &&
    args.audioRefCount > 0
  )
}

/**
 * The length of the soundtrack clip a run sends: the audio's own length, at
 * least {@link AUDIO_SOUNDTRACK_MIN_SEC} (padded with silence) and at most the
 * clip being made (the rest of a longer track is not played), on whole frames
 * of {@link AUDIO_SOUNDTRACK_FPS} — the length the rendered file measures, so
 * the quote, the estimate and the run's own reservation all read one number.
 * An audio whose length is unknown counts as the whole clip — the longest it
 * can be, so a price built from it is never below the run's.
 */
export function audioSoundtrackClipSec(audioSec: number, outputSec: number): number {
  const sec = !Number.isFinite(audioSec) || audioSec <= 0 ? outputSec : Math.min(outputSec, Math.max(AUDIO_SOUNDTRACK_MIN_SEC, audioSec))
  return Math.round(sec * AUDIO_SOUNDTRACK_FPS) / AUDIO_SOUNDTRACK_FPS
}

/**
 * The prompt for a soundtrack run: the soundtrack clip is reference video
 * `@video_<videoNumber>` (after the caller's own clips), so a mention of the
 * first audio clip (`@audio_1`) now names it, and the remaining audio clips
 * move down one (`@audio_2` → `@audio_1`). A sentence before the prompt says
 * what that clip is for, when it fits within `maxChars` (the model's prompt
 * limit) — a prompt already near the limit keeps only the renaming.
 */
export function audioSoundtrackPrompt(prompt: string, videoNumber: number, maxChars = Number.POSITIVE_INFINITY): string {
  const video = `@video_${videoNumber}`
  const renamed = prompt.replace(/@audio_(\d+)(?![\w一-龥])/g, (whole, digits: string) => {
    const n = Number(digits)
    if (n === 1) return video
    return n > 1 ? `@audio_${n - 1}` : whole
  })
  const lead =
    `${video} is the soundtrack: the people in the scene perform to this exact audio, ` +
    "their lips in sync with any singing or speech. Take only its sound, nothing from its picture."
  const withLead = renamed.trim() ? `${lead}\n${renamed}` : lead
  return withLead.length <= maxChars ? withLead : renamed
}
