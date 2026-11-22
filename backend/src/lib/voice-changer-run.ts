// @reads-none writes and reads only the audio it fetches into its own work dir
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { VOICE_CHANGER_MAX_SEC, VOICE_CHANGER_RATE_SECONDS, checkVoiceChangerLength, voiceChangerTooLongMessage, voiceChangerUnits } from "@nodaro/shared/credits"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { MediaTooLargeError, fetchMediaFromUrl } from "../providers/elevenlabs/client.js"
import { cleanupWorkDir, createWorkDir } from "../providers/video/ffmpeg-utils.js"
import { isStoppedLaunch, measureDecodedAudio } from "../providers/video/decoded-audio-length.js"
import { isRetryableProbeRefusal, probeLinkRefusal } from "../providers/video/probe-guard.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { probeSoundLengthSec } from "./video-utility-probe.js"

/**
 * What a Voice Changer run sends to speech-to-speech, held to what the run
 * was priced on (decided 2026-11-22): never bytes the price did not see.
 *
 * The run was priced on the length the route or the workflow run read at the
 * caller's link before anything was held (`voice-changer-input.ts`). The worker
 * reads the length again, by the same reader (`probeSoundLengthSec`), from the
 * very audio it sends:
 *
 *  - a video (video mode, or a video file in the audio slot): the audio track
 *    `extractAudioTrack` wrote ({@link checkExtractedVoiceChangerAudio});
 *  - an audio: the file fetched ONCE through the SSRF-safe fetch (under
 *    {@link VOICE_CHANGER_SOURCE_MAX_BYTES}), its sound DECODED from those
 *    bytes (`measureDecodedAudio`: the samples that play, never a header a
 *    file may state short), and sent as those exact bytes
 *    ({@link fetchVoiceChangerAudio}).
 *
 * Audio that would cost more units than the run holds (the link answered with
 * a different file), or that runs past the 5-minute cap, is refused before the
 * provider is asked: the job fails and its hold is refunded. A job queued
 * before the price followed the length holds no units: it is held to the cap
 * alone.
 */

/** The refusal of audio whose length the worker cannot read from its own copy. */
export const VOICE_CHANGER_SENT_UNREADABLE_MESSAGE =
  "Couldn't read the length of the audio. The file may be damaged or in an unsupported format."

/** The refusal of audio that reads longer than the run was priced for. */
export function voiceChangerLongerThanPricedMessage(sec: number, heldUnits: number): string {
  return `The audio is longer than when the run was priced (${Math.ceil(sec)} s, priced for up to ${heldUnits * VOICE_CHANGER_RATE_SECONDS} s). ` +
    "The link may have changed since: run it again, or upload the file and run it from the upload."
}

/**
 * How far past what the run was priced on the audio it sends may read. In
 * video mode the worker reads the MP3 it extracted from the video, not the
 * video the run was priced on, and an MP3 encode reads a few hundredths of a
 * second past the track it came from (the encoder's delay and padding: about
 * 0.05 s at 44.1 kHz, more at a lower rate). So a run priced right is never
 * refused for it; a link that answers with a longer file is still refused.
 */
export const VOICE_CHANGER_SENT_LENGTH_TOLERANCE_SEC = 0.5

/**
 * Refuse audio of `sec` seconds the run may not send: past the 5-minute cap
 * (every job), or more units than the run holds (a job that holds units),
 * each after forgiving {@link VOICE_CHANGER_SENT_LENGTH_TOLERANCE_SEC}.
 */
export function assertVoiceChangerSendable(sec: number, heldUnits?: number): void {
  const priced = Math.max(Number.MIN_VALUE, sec - VOICE_CHANGER_SENT_LENGTH_TOLERANCE_SEC)
  if (!checkVoiceChangerLength(priced).ok) throw new DeterministicJobError(voiceChangerTooLongMessage(sec))
  if (heldUnits !== undefined && voiceChangerUnits(priced) > heldUnits) {
    throw new DeterministicJobError(voiceChangerLongerThanPricedMessage(sec, heldUnits))
  }
}

/**
 * The length of a local audio file, by the reader that priced the run. A file
 * it cannot read is refused for good; a read the server could not run or that
 * ran out of time is left as it is, so the job is tried again.
 */
async function sentAudioSec(path: string): Promise<number> {
  let sec: number
  try {
    sec = await probeSoundLengthSec(path)
  } catch (err) {
    const refusal = probeLinkRefusal(err)
    if (refusal && isRetryableProbeRefusal(refusal)) throw err
    throw new DeterministicJobError(VOICE_CHANGER_SENT_UNREADABLE_MESSAGE, { cause: err })
  }
  if (!(sec > 0) || !Number.isFinite(sec)) throw new DeterministicJobError(VOICE_CHANGER_SENT_UNREADABLE_MESSAGE)
  return sec
}

/**
 * The audio track a video run extracted (`extractAudioTrack`), checked before
 * it is sent: its length, which may not cost more than the run holds or run
 * past the cap. Answers the length.
 */
export async function checkExtractedVoiceChangerAudio(audioPath: string, heldUnits?: number): Promise<number> {
  const sec = await sentAudioSec(audioPath)
  assertVoiceChangerSendable(sec, heldUnits)
  return sec
}

/** The audio an audio-mode run sends, and its length. */
export interface VoiceChangerSentAudio {
  readonly bytes: Buffer
  readonly sentSec: number
}

/** The most an audio-mode run downloads: five minutes of sound in any common format is well under it. */
export const VOICE_CHANGER_SOURCE_MAX_BYTES = 100_000_000

/** The refusal of an audio file past {@link VOICE_CHANGER_SOURCE_MAX_BYTES}. */
export const VOICE_CHANGER_SOURCE_TOO_LARGE_MESSAGE =
  "The audio file is larger than Voice Changer takes (100 MB). Use a compressed file of 5 minutes or less."

/** The refusal of audio whose decoded sound runs past the 5-minute cap (its decode stopped there, so its exact length is not known). */
export const VOICE_CHANGER_SENT_OVER_CAP_MESSAGE =
  "The audio is longer than 5 minutes. Voice Changer takes audio up to 5 minutes: split or trim it to 5 minutes or less first."

/**
 * The length of a local audio file as it PLAYS: decoded up to just past what a
 * run may send (the cap, its grace and the send tolerance). A decode our side
 * stopped (its time limit) is left as it is, so the job is tried again; a file
 * the decoder cannot read, could not read to its end (its length cannot be
 * trusted) or that has no sound is refused for good, and so is one that plays
 * past the cap.
 */
async function sentDecodedSec(path: string): Promise<number> {
  let decoded: Awaited<ReturnType<typeof measureDecodedAudio>>
  try {
    decoded = await measureDecodedAudio(path, { capSec: VOICE_CHANGER_MAX_SEC + CLIP_PRICE_GRACE_SEC + VOICE_CHANGER_SENT_LENGTH_TOLERANCE_SEC })
  } catch (err) {
    if (isStoppedLaunch(err)) throw err
    throw new DeterministicJobError(VOICE_CHANGER_SENT_UNREADABLE_MESSAGE, { cause: err })
  }
  if (decoded === undefined) throw new DeterministicJobError(VOICE_CHANGER_SENT_UNREADABLE_MESSAGE)
  if (decoded.overCap) throw new DeterministicJobError(VOICE_CHANGER_SENT_OVER_CAP_MESSAGE)
  return decoded.seconds
}

/**
 * The audio an audio-mode run sends: fetched once (SSRF-safe, under the byte
 * cap), its sound decoded from that copy and checked, and handed back as the
 * exact bytes to send.
 */
export async function fetchVoiceChangerAudio(audioUrl: string, heldUnits?: number): Promise<VoiceChangerSentAudio> {
  let bytes: Buffer
  try {
    bytes = await fetchMediaFromUrl(audioUrl, VOICE_CHANGER_SOURCE_MAX_BYTES)
  } catch (err) {
    if (err instanceof MediaTooLargeError) throw new DeterministicJobError(VOICE_CHANGER_SOURCE_TOO_LARGE_MESSAGE, { cause: err })
    throw err
  }
  const workDir = await createWorkDir("voice-changer")
  try {
    const path = join(workDir, "source")
    await writeFile(path, bytes)
    const sentSec = await sentDecodedSec(path)
    assertVoiceChangerSendable(sentSec, heldUnits)
    return { bytes, sentSec }
  } finally {
    await cleanupWorkDir(workDir).catch(() => {})
  }
}
