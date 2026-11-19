// @reads-none reads only the audio it downloads into its own work dir
import { join } from "node:path"
import {
  AUDIO_ISOLATION_MAX_BYTES,
  AUDIO_ISOLATION_RATE_SECONDS,
  audioIsolationUnits,
  checkAudioIsolationLength,
} from "@nodaro/shared/credits"
import {
  BIG_MEDIA_DOWNLOAD_LIMITS,
  cleanupWorkDir,
  createWorkDir,
  downloadFile,
  probeMediaFormatAndDuration,
  probeMediaStreams,
  runFfmpeg,
} from "../providers/video/ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "../providers/video/ffmpeg-memory-model.js"
import { directAudioIsolation, type IsolatedAudio } from "../providers/elevenlabs/audio-isolation.js"
import { config } from "./config.js"
import { requireProviderKey } from "../providers/provider-keys.js"
import { DeterministicJobError } from "./deterministic-job-error.js"
import { probeSoundLengthSec } from "./video-utility-probe.js"

/**
 * One Audio Isolation run, from the caller's link to the isolated audio:
 *
 *  1. The ElevenLabs key first — a keyless install fails with the house
 *     "needs ELEVENLABS_API_KEY" refusal before anything is downloaded.
 *  2. The file is downloaded once, under the big-media limits and the
 *     provider's 500 MB; a larger file is refused.
 *  3. The length is read from that copy by the same reader the route and the
 *     workflow run priced it with (`probeSoundLengthSec`), so the same file
 *     reads the same. A copy that would cost more units than the run holds
 *     (the link answered with a different file), or that is past 30 minutes,
 *     is refused; the job fails and its hold is refunded.
 *  4. The MEDIA decides what is sent, never the slot: a file with a picture
 *     (a video), or in a container ElevenLabs does not take, has its first
 *     audio track written to FLAC (lossless) and only that is sent — a video
 *     file never is. Any other file is sent as it came.
 *  5. ElevenLabs answers with the isolated audio, whose type is read from the
 *     response (`directAudioIsolation`).
 */

/** ffprobe's container names ElevenLabs takes as they are: MP3, WAV, FLAC, OGG (Vorbis, Opus), ADTS AAC, AIFF, and MP4/M4A (audio only). */
const SENT_AS_IS: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  aac: "audio/aac",
  aiff: "audio/aiff",
  m4a: "audio/mp4",
}

/** The file of the sent audio's type, as ffprobe names its container (`mov,mp4,m4a,…` → `audio/mp4`). */
export function sentAsIsContentType(formatNames: readonly string[]): string | undefined {
  for (const name of formatNames) if (Object.hasOwn(SENT_AS_IS, name)) return SENT_AS_IS[name]
  return undefined
}

export const AUDIO_ISOLATION_TOO_LARGE_MESSAGE = "The file is larger than 500 MB. Audio Isolation takes files up to 500 MB: trim it, or export the audio in a compressed format (MP3, M4A) first."
export const AUDIO_ISOLATION_NO_AUDIO_MESSAGE = "This file has no audio track to isolate."

/** What the run sent and what came back. */
export interface AudioIsolationRunResult {
  readonly isolated: IsolatedAudio
  /** The length of the audio sent, in seconds. */
  readonly sentSec: number
  /** Whether the sound was taken out of the file (a video, or a container sent as FLAC). */
  readonly converted: boolean
}

export interface AudioIsolationRunInput {
  readonly audioUrl: string
  /** The units the run holds (the route's or the workflow run's reading); absent on a job queued before units existed. */
  readonly heldUnits?: number
  /** Runs the provider call (the worker's progress ramp); defaults to calling it as it is. */
  readonly withProgress?: <T>(call: () => Promise<T>) => Promise<T>
}

function isByteCapRefusal(err: unknown): boolean {
  return err instanceof Error && /^Download exceeds /.test(err.message)
}

export async function runAudioIsolation(input: AudioIsolationRunInput): Promise<AudioIsolationRunResult> {
  // 1. The key, before anything is downloaded. The nodaro.ai connection does not
  //    run this node (no relay route), so the sentence never offers it as cover.
  requireProviderKey(config.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY", "Audio Isolation", { coveredByConnection: false })

  const workDir = await createWorkDir("audio-isolation")
  try {
    // 2. Download once, under the provider's size limit.
    const sourcePath = join(workDir, "source")
    try {
      await downloadFile(input.audioUrl, sourcePath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: AUDIO_ISOLATION_MAX_BYTES })
    } catch (err) {
      if (isByteCapRefusal(err)) throw new DeterministicJobError(AUDIO_ISOLATION_TOO_LARGE_MESSAGE, { cause: err })
      throw err
    }

    // 3. Its length, by the reader that priced it.
    let sec: number
    try {
      sec = await probeSoundLengthSec(sourcePath)
    } catch (err) {
      throw new DeterministicJobError("Couldn't read the length of the audio. The file may be damaged or in an unsupported format.", { cause: err })
    }
    const length = checkAudioIsolationLength(sec)
    if (!length.ok) throw new DeterministicJobError(length.message)
    if (input.heldUnits !== undefined && audioIsolationUnits(sec) > input.heldUnits) {
      throw new DeterministicJobError(
        `The audio is longer than when the run was priced (${Math.ceil(sec)} s, priced for up to ${input.heldUnits * AUDIO_ISOLATION_RATE_SECONDS} s). ` +
        "The link may have changed since: run it again, or upload the file and run it from the upload.",
      )
    }

    // 4. The media decides what is sent.
    const streams = await probeMediaStreams(sourcePath)
    if (!streams.hasAudio) throw new DeterministicJobError(AUDIO_ISOLATION_NO_AUDIO_MESSAGE)
    const asIs = streams.hasVideo ? undefined : sentAsIsContentType((await probeMediaFormatAndDuration(sourcePath)).formatNames ?? [])
    let sendPath = sourcePath
    let sendType = asIs
    if (!sendType) {
      sendPath = join(workDir, "audio.flac")
      await runFfmpeg(
        ["-nostdin", "-v", "error", "-y", "-i", sourcePath, "-map", "0:a:0", "-vn", "-c:a", "flac", sendPath],
        undefined,
        { peakMemoryMiB: audioPeakMemoryMiB() },
      )
      sendType = "audio/flac"
    }

    // 5. Isolate.
    const call = () => directAudioIsolation(sendPath, { audioSec: sec, sourceContentType: sendType! })
    const isolated = await (input.withProgress ? input.withProgress(call) : call())
    return { isolated, sentSec: sec, converted: sendPath !== sourcePath }
  } finally {
    await cleanupWorkDir(workDir).catch(() => {})
  }
}
