/**
 * The refusals of a use-case run's recordings (decided 2026-10-17), by the
 * route's code: one wording for the failed call's reason (api-error-copy.ts),
 * a node's refusal (execution-error-text.ts) and the settings panel's badge of
 * the same problem. English is the route's own sentence (pinned by
 * use-case-cameras-note.test.ts). Dependency-free, so any of them may import it.
 */
import type { MessageKey } from "@/lib/i18n"

export const USE_CASE_RECORDINGS_REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  too_many_recordings: "apiErr.reason.tooManyRecordings",
  recordings_two_audio_only: "apiErr.reason.recordingsTwoAudioOnly",
  wide_camera_out_of_range: "apiErr.reason.wideCameraOutOfRange",
  master_audio_unreadable: "apiErr.reason.masterAudioUnreadable",
}
