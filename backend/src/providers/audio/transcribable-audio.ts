import type { TranscribeLane } from "@nodaro/shared/models"
import { extractAudioTrack, NoAudioTrackError } from "../video/extract-audio-track.js"
import { cleanupWorkDir } from "../video/ffmpeg-utils.js"
import { getJobId } from "../../lib/job-cancellation.js"

/**
 * Whether a transcription lane reads only an audio FILE. The two Replicate
 * whisper models decode the URL as a sound file and refuse anything else ("Soundfile
 * is either not in the correct format…"), so a video — an Add Captions source,
 * or a video wired into Transcribe — must reach them as its audio track. Scribe
 * takes video files itself, and Nemotron's caller already hands it an
 * extracted track.
 *
 * A `Record` over every lane, so a new lane does not compile until it says
 * which it is.
 */
export const LANE_NEEDS_AUDIO_FILE: Readonly<Record<TranscribeLane, boolean>> = Object.freeze({
  whisper: true,
  "incredibly-fast-whisper": true,
  "elevenlabs-stt": false,
  "nemotron-3-5-transcribe": false,
})

/** Audio file extensions the whisper models accept as they are. */
const ACCEPTED_AUDIO_EXTENSION = /\.(?:mp3|wav|flac)$/i

/** The file at `url` has no audio track, so there is nothing to transcribe. */
export class NoAudioToTranscribeError extends Error {
  constructor() {
    super("This file has no audio track to transcribe. Use a clip with speech in it, or give the text another way.")
    this.name = "NoAudioToTranscribeError"
  }
}

/** Whether `lane` reads only an audio file. An unknown lane answers `false` (sent as it is, as before). */
export function laneNeedsAudioFile(lane: string): boolean {
  return LANE_NEEDS_AUDIO_FILE[lane as TranscribeLane] === true
}

/** Whether `url` already names an audio file the whisper models accept: its path ends in .mp3, .wav or .flac. */
export function isAcceptedAudioFile(url: string): boolean {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split(/[?#]/)[0] ?? url
  }
  return ACCEPTED_AUDIO_EXTENSION.test(path)
}

export interface TranscribableAudio {
  /** The URL to transcribe: the original, or the stored MP3 of its audio track. */
  readonly url: string
  /** Deletes the stored MP3 once the transcription has read it. Never throws. */
  readonly discard: () => Promise<void>
}

/**
 * The audio of `url` as an MP3 the whisper models read: its audio track
 * extracted and stored in the running job's scratch folder. A URL that already
 * names an accepted audio file is returned as it is, with nothing to discard.
 * Throws `NoAudioToTranscribeError` when the file has no audio track.
 */
export async function toTranscribableAudio(url: string): Promise<TranscribableAudio> {
  if (isAcceptedAudioFile(url)) return { url, discard: async () => {} }
  let extracted: Awaited<ReturnType<typeof extractAudioTrack>>
  try {
    extracted = await extractAudioTrack(url)
  } catch (err) {
    if (err instanceof NoAudioTrackError) throw new NoAudioToTranscribeError()
    throw err
  }
  // Loaded here, not at the top: the scratch store brings the database client,
  // which nothing on the transcribe path needs until a file is converted.
  const { discardJobScratchFile, uploadJobScratchFile } = await import("../../lib/job-scratch.js")
  const jobId = getJobId()
  let audioUrl: string
  try {
    audioUrl = await uploadJobScratchFile(extracted.audioPath, "transcribe-audio", "mp3", "audio/mpeg", jobId)
  } finally {
    await cleanupWorkDir(extracted.workDir)
  }
  return {
    url: audioUrl,
    discard: async () => {
      if (jobId) await discardJobScratchFile(audioUrl, jobId)
    },
  }
}
