/**
 * Audio-to-video's sound (LTX 2.5 Fast — decided 2026-11-23): the clip is
 * made to its audio, so it must carry that audio. When the provider's output
 * has an audio stream nothing is done here and the caller stores the render
 * as it does every render. When it has none, the driving clip is laid on
 * (replacing nothing: there is no track), fitted to the picture so it never
 * outlasts it, and the merged file — kept local — is watermarked (when the
 * job is) and stored ONCE, at the job's own key (`watermarkLocalVideoAndUpload`,
 * the Lip Sync voice line's way): the caller hands that url to finalize as
 * the job's media, so nothing is stored twice and no unwatermarked copy is
 * left behind.
 *
 * THE one step for both ways such a job ends: the worker after its render,
 * and the reconcile for a job it recovers from KIE's saved task.
 *
 * Never fails the paid render: a probe or merge failure leaves the render to
 * be stored as it came, logged. A deploy's drain is not a failure of this
 * step: it is rethrown, so the job is picked up again.
 */
import { dirname } from "node:path"
import { mergeVideoAudio } from "../providers/video/merge-video-audio.js"
import { cleanupWorkDir, probeMediaStreams } from "../providers/video/ffmpeg-utils.js"
import { watermarkLocalVideoAndUpload } from "../workers/shared.js"
import { draftAudioMuxMergeArgs, voiceTrackMuxRecipe } from "./seedance-draft-audio.js"
import type { StoredVideo } from "./video-result-store.js"
import { isDrainAbortError } from "./worker-drain.js"

/** Is this job an audio-to-video run (stamped by the server after measuring), and which clip drives it? */
export function drivingAudioUrlOf(input: Record<string, unknown> | null | undefined): string | undefined {
  if (input?.audioToVideo !== true) return undefined
  const urls = input.referenceAudioUrls
  return Array.isArray(urls) && typeof urls[0] === "string" && urls[0] ? urls[0] : undefined
}

/** What the step did: the stored, laid-on file (the job's final media), or nothing (store the render as it came). */
export type DrivingAudioLayResult = { readonly kind: "stored"; readonly url: string; readonly stored: StoredVideo } | { readonly kind: "as-rendered" }

export async function layDrivingAudioIfSilent(args: {
  videoUrl: string
  /** The render already on local disk (a loop cut): read from there instead of `videoUrl`. */
  videoPath?: string
  audioUrl: string | undefined
  jobId: string
  userId: string | undefined
  /** The job is watermarked: the one stored copy is. */
  watermark: boolean
  /** Injectable for tests. */
  deps?: {
    probe?: typeof probeMediaStreams
    merge?: typeof mergeVideoAudio
    store?: typeof watermarkLocalVideoAndUpload
  }
}): Promise<DrivingAudioLayResult> {
  const probe = args.deps?.probe ?? probeMediaStreams
  const merge = args.deps?.merge ?? mergeVideoAudio
  const store = args.deps?.store ?? watermarkLocalVideoAndUpload
  if (!args.audioUrl) return { kind: "as-rendered" }
  try {
    const streams = await probe(args.videoPath ?? args.videoUrl)
    if (streams.hasAudio) return { kind: "as-rendered" }
  } catch (err) {
    if (isDrainAbortError(err)) throw err
    console.warn(`[driving-audio] job ${args.jobId}: could not probe the render for an audio stream; storing it as rendered:`, err)
    return { kind: "as-rendered" }
  }
  let merged: string | undefined
  try {
    // Fitted to the picture: the audio never outlasts the clip.
    merged = await merge({
      ...draftAudioMuxMergeArgs(args.videoUrl, voiceTrackMuxRecipe(args.audioUrl)),
      ...(args.videoPath ? { videoPath: args.videoPath } : {}),
      fitAudioToVideo: true,
    })
    // Through the video result funnel (lib/video-result-store.ts): the stored
    // file and, where it keeps one, the original beside it.
    const stored = await store(merged, args.jobId, args.userId, args.watermark)
    console.warn(`[driving-audio] job ${args.jobId}: the render had no audio stream; the driving clip was laid on`)
    return { kind: "stored", url: stored.videoUrl, stored }
  } catch (err) {
    if (isDrainAbortError(err)) throw err
    // A cancel is final (never stored again as rendered). Anything else —
    // an unusable verdict on OUR OWN merge output included — falls back to
    // the provider's render as it came, the video the user paid for, as
    // before this change (decided 2026-11-24).
    if ((err as { name?: unknown } | null)?.name === "JobCancelledError") throw err
    console.warn(`[driving-audio] job ${args.jobId}: laying the driving clip on a silent render failed; storing it as rendered:`, err)
    return { kind: "as-rendered" }
  } finally {
    if (merged) await cleanupWorkDir(dirname(merged))
  }
}
