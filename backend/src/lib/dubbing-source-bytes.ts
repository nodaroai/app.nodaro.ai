// @reads-none reads only the file it downloads into its own work dir
/**
 * The file a dub uploads to the dubbing service: fetched ONCE, its sound held
 * to the minutes the run was paid for, and uploaded as those exact bytes
 * (decided 2026-11-22).
 *
 * A dub is priced on the length measured at the caller's link before anything
 * is held (the route's preHandler, a workflow run's stamp). That measure reads
 * the length the file states, at a link the caller controls: a second fetch can
 * answer with a different file, and a file can state less than it plays. So
 * the worker downloads the file once, decodes the sound of THOSE bytes (the
 * decode Lip Sync is priced by, `measureDecodedAudio`: the samples that play,
 * never a header), refuses a dub that would run past what was held before the
 * service is asked (the job fails and is refunded), and uploads the bytes it
 * measured. The link itself is never handed on.
 *
 * What the service dubs is the span `effectiveDubbedSeconds` reads (the window
 * when the request set both ends, else the whole file), the span the route
 * prices. A run is held for whole minutes (`dubbingHeldMinutes`), so the sound
 * may run up to those minutes plus {@link DUBBING_SENT_LENGTH_TOLERANCE_SEC}.
 */
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { dubbingHeldMinutes, effectiveDubbedSeconds } from "@nodaro/render-rules"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { withinCapGrace } from "./measured-cap-grace.js"
import { fetchMediaFromUrl } from "../providers/elevenlabs/client.js"
import { DUBBING_MAX_DURATION_SEC, DUBBING_MAX_SOURCE_BYTES } from "../providers/elevenlabs/dubbing.js"
import { cleanupWorkDir, createWorkDir } from "../providers/video/ffmpeg-utils.js"
import { classifyMediaSource, isVideoMode, type MediaSlot } from "../providers/video/media-source.js"
import { isStoppedLaunch, measureDecodedAudio, type DecodedAudioLength } from "../providers/video/decoded-audio-length.js"

/**
 * How far past its held minutes a dub's sound may play: a decoder and the
 * length a container states can differ by a frame or two at the end, and a
 * second is a sixtieth of the smallest hold.
 */
export const DUBBING_SENT_LENGTH_TOLERANCE_SEC = 1

/** What a dub was held for, as its job carries it. */
export interface DubbingHeldSpan {
  /** The span measured before the hold, in seconds; absent when the run was held at the 30-minute ceiling. */
  readonly probedDurationSec?: number
  readonly startTime?: number
  readonly endTime?: number
}

/** The seconds a dub's hold covers: the whole minutes of its measured span, or the 30-minute ceiling. */
export function dubbingHeldSeconds(held: DubbingHeldSpan): number {
  return typeof held.probedDurationSec === "number" && held.probedDurationSec > 0
    ? dubbingHeldMinutes(held.probedDurationSec) * 60
    : DUBBING_MAX_DURATION_SEC
}

/** The longest span a dub may run and stay within its hold. */
export function dubbingSentLimitSec(held: DubbingHeldSpan): number {
  return dubbingHeldSeconds(held) + DUBBING_SENT_LENGTH_TOLERANCE_SEC
}

/** A window set on both ends that fits the hold bounds the dub, whatever the file's length: nothing to measure. */
export function dubbingWindowFitsHold(held: DubbingHeldSpan): boolean {
  if (held.startTime == null || held.endTime == null) return false
  const window = Math.ceil(held.endTime - held.startTime)
  return window > 0 && window <= dubbingSentLimitSec(held)
}

/** Whether a span of `sourceSec` seconds of source would be dubbed past the hold. */
export function dubbingSpanExceedsHold(sourceSec: number, held: DubbingHeldSpan): boolean {
  if (dubbingWindowFitsHold(held)) return false
  const span = effectiveDubbedSeconds(sourceSec, held.startTime, held.endTime) ?? sourceSec
  return span > dubbingSentLimitSec(held)
}

/** Whether the decoded sound of the file to send would be dubbed past the hold (`overCap`: it plays past the limit). */
export function decodedDubbingExceedsHold(decoded: DecodedAudioLength, held: DubbingHeldSpan): boolean {
  if (dubbingWindowFitsHold(held)) return false
  return decoded.overCap || dubbingSpanExceedsHold(decoded.seconds, held)
}

/** The refusal of a measured dub whose file plays longer than it was priced at. */
export const DUBBING_LONGER_THAN_PRICED_MESSAGE =
  "The file to dub plays longer than the length it was priced at, so it was not sent. Run the dub again to price the file as it is now."

/** The refusal of a measured dub whose file has no sound the decoder can read. */
export const DUBBING_SOUND_UNREADABLE_MESSAGE =
  "The sound of the file to dub could not be read. Use a common audio or video file that has a sound track."

/** The refusal of a dub held at the 30-minute ceiling whose file plays past it. */
export const DUBBING_OVER_CAP_MESSAGE =
  `The span to dub is longer than ${DUBBING_MAX_DURATION_SEC / 60} minutes, the maximum. ` +
  "Trim the clip, or set a start/end window to dub part of it."

/** The refusal of a dub whose span runs past its hold, by how the run was held. */
export function dubbingOverHoldMessage(held: DubbingHeldSpan): string {
  return typeof held.probedDurationSec === "number" && held.probedDurationSec > 0
    ? DUBBING_LONGER_THAN_PRICED_MESSAGE
    : DUBBING_OVER_CAP_MESSAGE
}

/**
 * A span the dubbing service read (its own `media_metadata.duration`) that
 * runs past what the run was held for fails the job — never retried, refunded,
 * never delivered: a measured span by more than the hold's tolerance
 * (`dubbingSpanExceedsHold`), a run held at the 30-minute ceiling past the cap
 * (a hair past it, the 0.05 s the hold forgives, is the cap's, as before the
 * run). Asked at the worker's early poll and final status, and on every
 * delivery, the worker's and the reconcile lane's (`deliverDubbedMedia`).
 */
export function assertServiceSpanWithinHold(sourceSec: number, held: DubbingHeldSpan): void {
  if (typeof held.probedDurationSec === "number" && held.probedDurationSec > 0) {
    if (dubbingSpanExceedsHold(sourceSec, held)) throw new DeterministicJobError(DUBBING_LONGER_THAN_PRICED_MESSAGE)
    return
  }
  const effective = effectiveDubbedSeconds(sourceSec, held.startTime, held.endTime) ?? sourceSec
  if (!withinCapGrace(effective, DUBBING_MAX_DURATION_SEC, CLIP_PRICE_GRACE_SEC)) {
    throw new DeterministicJobError(
      `The span to dub is ${Math.ceil(effective / 60)} minutes; the maximum is ${DUBBING_MAX_DURATION_SEC / 60} minutes. ` +
      `Trim the clip, or set a start/end window to dub part of it.`,
    )
  }
}

/** A file a dub uploads, read once and checked: the bytes to send and the mode its own streams decide. */
export interface PreparedDubbingUpload {
  readonly bytes: Buffer
  /** Video out only when the video slot carries a picture (`isVideoMode`). */
  readonly videoMode: boolean
  readonly mime: string
  readonly ext: string
}

/**
 * Decode the sound of the file at `path` up to the hold's limit and refuse a
 * dub that would run past it. A file whose sound the decoder cannot read, or
 * could not read to its end (so its length cannot be trusted), is refused when
 * its length was measured (the measure was of another file, or the file states
 * less than it plays), and passes when the run was held at the ceiling (the
 * service reads it, its reading is held to the ceiling at delivery, and the run
 * settles to the span it dubbed).
 */
async function holdToPaidLength(path: string, held: DubbingHeldSpan): Promise<void> {
  if (dubbingWindowFitsHold(held)) return
  let decoded: DecodedAudioLength | undefined
  try {
    decoded = await measureDecodedAudio(path, { capSec: dubbingSentLimitSec(held) })
  } catch (err) {
    // Our side stopped the decode (its time limit): not the file's fault, tried again.
    if (isStoppedLaunch(err)) throw err
    // Anything else — a decode that stopped part-way (`isAudioReadStopped`) as
    // much as one that read nothing — leaves the length unknown (below).
  }
  if (decoded === undefined) {
    if (typeof held.probedDurationSec === "number" && held.probedDurationSec > 0) {
      throw new DeterministicJobError(DUBBING_SOUND_UNREADABLE_MESSAGE)
    }
    return
  }
  if (decodedDubbingExceedsHold(decoded, held)) throw new DeterministicJobError(dubbingOverHoldMessage(held))
}

/**
 * Download the file a dub uploads (`url`, through the SSRF-safe fetch, under
 * the source byte cap), decide its mode from its own streams, hold its sound to
 * what the run was paid for, and hand back the bytes to send.
 */
export async function prepareDubbingUpload(url: string, slot: MediaSlot, held: DubbingHeldSpan): Promise<PreparedDubbingUpload> {
  const bytes = await fetchMediaFromUrl(url, DUBBING_MAX_SOURCE_BYTES)
  const workDir = await createWorkDir("dub-source")
  try {
    const path = join(workDir, "source")
    await writeFile(path, bytes)
    const source = await classifyMediaSource(path, slot)
    await holdToPaidLength(path, held)
    return {
      bytes,
      videoMode: isVideoMode(source),
      mime: source.hasVideo ? "video/mp4" : "audio/mpeg",
      ext: source.hasVideo ? "mp4" : "mp3",
    }
  } finally {
    await cleanupWorkDir(workDir).catch(() => {})
  }
}
