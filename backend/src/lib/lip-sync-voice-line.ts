import { dirname } from "node:path"
import { SEEDANCE_LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"
import { mergeVideoAudio } from "../providers/video/merge-video-audio.js"
import { cleanupWorkDir, probeMediaStreams } from "../providers/video/ffmpeg-utils.js"
import { watermarkLocalVideoAndUpload } from "../workers/shared.js"
import { draftAudioMuxMergeArgs, voiceTrackMuxRecipe } from "./seedance-draft-audio.js"
import { isDrainAbortError } from "./worker-drain.js"

/**
 * A Lip Sync whose model takes the voice line as a REFERENCE (the image-to-video
 * lane: the Seedance 2 family and MiniMax Hailuo 3) always carries the voice the
 * caller gave it (decided 2026-11-17).
 *
 * Those models read the voice to move the lips; the clip they return does not
 * reliably carry it. Measured on delivered results, 2026-11-17: Seedance 2
 * (480p and 720p) and Seedance 2.5 Flash (480p) each returned an 8 s MP4 with
 * one video stream and no audio stream. So the delivered clip decides, never
 * the model's name: a clip with NO audio stream gets the caller's voice line
 * laid on it; a clip that already has one is left exactly as it is.
 *
 * The mux is `mergeVideoAudio` with the voiced lane's own recipe
 * (`voiceTrackMuxRecipe`): the picture is stream-copied, the voice starts at 0
 * and is fitted to the picture's length (cut when longer, silence when
 * shorter, never stretched).
 */

/** True for a lip-sync model that is sent the voice line as reference audio. */
export function lipSyncSendsVoiceAsReference(provider: unknown): boolean {
  return typeof provider === "string" && SEEDANCE_LIP_SYNC_PROVIDERS.has(provider)
}

/**
 * The voice line could not be put on a silent lip-sync result. A PLAIN error
 * on purpose (never a `PostProcessingError`, whatever the failing step threw):
 * a lip sync with no voice is not a result, so the job fails and is REFUNDED
 * instead of being delivered and charged.
 */
export class LipSyncVoiceLineError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The voice could not be added to the lip-sync video.", options)
    this.name = "LipSyncVoiceLineError"
  }
}

/** What the step did with the provider's clip. */
export type VoiceLineOutcome =
  /** The clip had no audio stream: the voice line was laid on it and THIS file stored. */
  | { readonly kind: "muxed"; readonly url: string }
  /** The clip already carries audio: the caller stores it as it came. */
  | { readonly kind: "has-audio" }
  /** The clip could not be probed: the caller stores it as it came (see below). */
  | { readonly kind: "probe-failed" }
  /** The clip is silent and the voice line cannot be read: the caller stores the clip as it came (see below). */
  | { readonly kind: "voice-unreadable" }

/** The stored voiced clip's URL, when the step made one. */
export function voicedUrlOf(outcome: VoiceLineOutcome | undefined): string | undefined {
  return outcome?.kind === "muxed" ? outcome.url : undefined
}

/** The `extraOutputData` a finalize records for the step (empty when the clip came with audio). */
export function voiceLineOutputData(outcome: VoiceLineOutcome | undefined): { voiceLineMuxed?: true; voiceLineProbeFailed?: true; voiceLineUnreadable?: true } {
  if (outcome?.kind === "muxed") return { voiceLineMuxed: true }
  if (outcome?.kind === "probe-failed") return { voiceLineProbeFailed: true }
  if (outcome?.kind === "voice-unreadable") return { voiceLineUnreadable: true }
  return {}
}

/** A download refused for good: any 4xx but the ones that ask to come back later. */
const PERMANENT_DOWNLOAD_STATUS = /\((4\d\d)\)$/
const RETRYABLE_4XX: ReadonlySet<string> = new Set(["408", "425", "429"])

/**
 * True when the mux failed because the VOICE LINE itself cannot be read, a
 * property of the job's input that every further attempt repeats:
 * - its link answers a 4xx at download (`downloadFile`: `Failed to download:
 *   <url> (<status>)`, matched on the voice's own URL — never the clip's);
 * - ffmpeg finds no audio stream in it (`Stream specifier ':a' … matches no
 *   streams`: the merge's filter reads the voice as input 1);
 * - ffmpeg cannot open it (`Invalid data found when processing input`, named
 *   on input 1 / the merge's `audio_0` file — never the clip, input 0).
 * A killed, timed-out or never-started ffmpeg, a 5xx or 408/425/429 download
 * and every upload failure are NOT this: they stay retryable.
 */
export function isUnreadableVoiceLine(err: unknown, voiceUrl: string): boolean {
  let cur: unknown = err
  for (let depth = 0; depth < 8 && typeof cur === "object" && cur !== null; depth++) {
    const e = cur as { message?: unknown; killed?: unknown; timedOut?: unknown; notStarted?: unknown; aborted?: unknown; cause?: unknown }
    if (e.killed === true || e.timedOut === true || e.notStarted === true || e.aborted === true) return false
    const msg = typeof e.message === "string" ? e.message : ""
    if (msg.startsWith(`Failed to download: ${voiceUrl} (`)) {
      const status = PERMANENT_DOWNLOAD_STATUS.exec(msg)?.[1]
      if (status !== undefined && !RETRYABLE_4XX.has(status)) return true
    }
    if (msg.startsWith("ffmpeg failed:")) {
      if (/Stream specifier ':a'[^\n]*matches no streams/.test(msg)) return true
      if (msg.includes("Invalid data found when processing input") && /\[in#1 |audio_0\./.test(msg)) return true
    }
    cur = e.cause
  }
  return false
}

/**
 * Probe the provider's clip; when it has no audio stream, lay `voiceUrl` on it,
 * watermark (when the job is watermarked) and store it.
 *
 * - The clip already carries audio: `has-audio`, nothing is touched.
 * - The PROBE itself fails (the probe guard, the network): FAIL-OPEN, like
 *   this lane's other probes of a provider's output (decided 2026-11-17) —
 *   `probe-failed`, the caller stores the provider's clip as it came and the
 *   job records `voiceLineProbeFailed: true`. A probe problem must not take
 *   every lip sync on this lane down.
 * - The probe shows no audio stream and the VOICE LINE cannot be read
 *   ({@link isUnreadableVoiceLine}: its link is gone, or it holds no audio):
 *   `voice-unreadable`, the caller stores the provider's clip as it came and
 *   the job records `voiceLineUnreadable: true` (decided 2026-11-17). No
 *   attempt would end differently, so the job is not left to retry.
 * - The probe shows no audio stream and the voice cannot be added for any
 *   other reason (a timeout, a killed ffmpeg, the upload, a 5xx on the
 *   download, no voice line given): throws {@link LipSyncVoiceLineError} —
 *   nothing is stored, and no provider is called.
 */
export async function addVoiceLineIfSilent(args: {
  /** The provider's delivered clip. */
  videoUrl: string
  /** The caller's voice line (a recovered job's input may lack it: only a silent clip needs it). */
  voiceUrl: string | undefined
  jobId: string
  userId: string | undefined
  watermark: boolean
}): Promise<VoiceLineOutcome> {
  let streams: Awaited<ReturnType<typeof probeMediaStreams>>
  try {
    streams = await probeMediaStreams(args.videoUrl)
  } catch (err) {
    if (isDrainAbortError(err)) throw err
    console.warn(`[lip-sync] job ${args.jobId}: the delivered clip could not be probed for an audio stream; delivering it as it came:`, err)
    return { kind: "probe-failed" }
  }
  if (streams.hasAudio) return { kind: "has-audio" }
  const voiceUrl = args.voiceUrl
  try {
    if (!voiceUrl) throw new Error("lip-sync voice line missing from the job's input")
    console.log(`[lip-sync] job ${args.jobId}: the delivered clip has no audio stream; adding the voice line`)
    const mergedPath = await mergeVideoAudio({
      ...draftAudioMuxMergeArgs(args.videoUrl, voiceTrackMuxRecipe(voiceUrl)),
      fitAudioToVideo: true,
    })
    try {
      return { kind: "muxed", url: await watermarkLocalVideoAndUpload(mergedPath, args.jobId, args.userId, args.watermark) }
    } finally {
      await cleanupWorkDir(dirname(mergedPath))
    }
  } catch (err) {
    // A deploy's drain re-picks the job: not a failure of this step.
    if (isDrainAbortError(err)) throw err
    if (voiceUrl && isUnreadableVoiceLine(err, voiceUrl)) {
      console.warn(`[lip-sync] job ${args.jobId}: the voice line cannot be read, so it was not added; delivering the clip as it came:`, err)
      return { kind: "voice-unreadable" }
    }
    console.error(`[lip-sync] job ${args.jobId}: could not add the voice line to the delivered clip:`, err)
    throw new LipSyncVoiceLineError({ cause: err })
  }
}
