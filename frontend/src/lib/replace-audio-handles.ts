/**
 * Replace Audio's input pips: one row per pip, read by the node's own
 * `HandleWithPopover` (its label and `accepts`), the drag-to-connect validator
 * (`connection-validation.ts` → `isValidReplaceAudioConnection`) and the
 * source-direction popover registry (`target-handle-registry.ts`), so the three
 * can never disagree.
 *
 * `in` takes the video whose sound is replaced; `music` takes the new music —
 * an audio, or a video whose sound is used. The node's request body takes
 * exactly one music source (`replaceAudioNodeBody`, `@nodaro/render-rules`),
 * which refuses a second one before anything is sent.
 */
import { ACCEPTS_MEDIA, ACCEPTS_VIDEO } from "./ffmpeg-handles"

/** The video whose sound is replaced. */
export const REPLACE_AUDIO_VIDEO_HANDLE = "in"
/** The new music: an audio, or a video whose sound is used. */
export const REPLACE_AUDIO_MUSIC_HANDLE = "music"

export interface ReplaceAudioTargetHandle {
  readonly handleId: string
  readonly label: string
  readonly accepts: (sourceType: string) => boolean
}

/** The input pips, in the order the node draws them. */
export const REPLACE_AUDIO_TARGET_HANDLES: readonly ReplaceAudioTargetHandle[] = [
  { handleId: REPLACE_AUDIO_VIDEO_HANDLE, label: "Video", accepts: ACCEPTS_VIDEO },
  { handleId: REPLACE_AUDIO_MUSIC_HANDLE, label: "Music", accepts: ACCEPTS_MEDIA },
]

/** Whether a wire from `sourceType` may enter Replace Audio's `targetHandle` (no other id is an input). */
export function isValidReplaceAudioConnection(targetHandle: string, sourceType: string): boolean {
  const row = REPLACE_AUDIO_TARGET_HANDLES.find((h) => h.handleId === targetHandle)
  return row ? row.accepts(sourceType) : false
}
