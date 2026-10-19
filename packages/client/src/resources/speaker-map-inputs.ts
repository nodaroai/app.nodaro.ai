import type { Transcript } from "@nodaro/shared/edl"
import type { AudioSyncResult } from "./edit.js"

/** One recording for {@link EditResource.speakerMap}: a camera, or the master / wide shot. */
export interface SpeakerMapSource {
  /**
   * Your id for this recording (1–200 chars, unique within the request) — the
   * camera id the map names. Use the id your EDL gives the same recording
   * (`EdlSource.id`), so the map fits Camera Switch as it is.
   */
  id: string
  /** An audio OR video URL — the audio track is read either way. */
  url: string
  /** `"audio"` for a sound-only recording (a master mic): never anyone's camera, and never the wide shot. Default `"video"`. */
  kind?: "video" | "audio"
}

/**
 * Input for {@link EditResource.speakerMap}: which camera each speaker is on,
 * worked out from the cameras' own microphones. While a speaker talks, the
 * camera that hears them loudest by at least `marginDb` is theirs; a speaker
 * with no clear camera gets `""` (shown on the wide shot), and a camera that
 * heard nothing is a note, never a failure.
 */
export interface SpeakerMapInput {
  /** 2–6 recordings: the cameras, and the master / wide when you name them. */
  sources: SpeakerMapSource[]
  /** The word transcript WITH speaker labels (transcribe with speaker detection). */
  transcript: Transcript
  /** An audio-sync result ({@link EditResource.audioSync}); omit when the recordings already share a clock. */
  offsets?: AudioSyncResult
  /** The id of the master audio: hears everyone, so it is no one's camera. */
  masterSourceId?: string
  /** The id of the wide shot: no one's camera; a speaker with no clear camera is shown on it. */
  wideSourceId?: string
  /** How much louder (dB) the loudest camera must be than the next for a speaker to get it. Default 3. */
  marginDb?: number
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}
