/**
 * The go-live gate of Speaker View's video mode (decided 2026-10-12).
 *
 * A bare video fed to Speaker View runs Speaker Frames (face tracks) behind
 * it, so the mode is live only when Speaker Frames is priced AND Speaker View
 * is. Until then every surface that touches it refuses or hides, with ONE
 * message: the video input (Zod, both engines, MCP), the clip-measuring route,
 * the face-presence check, "Add Transcribe" in video mode, the Reframe macro,
 * and the template's seeding. Edit-driven Speaker View is NOT behind this: it
 * stays priced and live.
 *
 * ONE predicate. A surface asks `speakerViewVideoModeLive()` /
 * `speakerViewVideoModeRefusal()` and never combines the two price flags
 * itself (a guard test fails the build on a hand-written combination), so the
 * day Speaker Frames is priced is one flag, and nothing opens before the rest.
 */
import { SPEAKER_FRAMES_PRICED } from "./speaker-frames"
import { SPEAKER_VIEW_PRICED } from "./speaker-view-settings"

/** The one sentence every refused surface shows. */
export const SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE =
  "Speaker View from a video is not available yet. Use an edit as the input instead. Nothing was charged."

/** The price flags the gate reads; a caller passes none (the real flags) and a
 *  test passes the pair it wants to stand in for. */
export interface SpeakerViewVideoGateFlags {
  readonly viewPriced?: boolean
  readonly framesPriced?: boolean
}

export interface SpeakerViewVideoModeRefusal {
  readonly code: "video-mode-not-live"
  readonly message: string
}

/** True when Speaker View's video mode may run: Speaker View AND Speaker Frames are priced. */
export function speakerViewVideoModeLive(flags: SpeakerViewVideoGateFlags = {}): boolean {
  const viewPriced = flags.viewPriced ?? SPEAKER_VIEW_PRICED
  const framesPriced = flags.framesPriced ?? SPEAKER_FRAMES_PRICED
  return viewPriced === true && framesPriced === true
}

/** Null when the mode is live; otherwise the one refusal every surface shows. */
export function speakerViewVideoModeRefusal(flags: SpeakerViewVideoGateFlags = {}): SpeakerViewVideoModeRefusal | null {
  return speakerViewVideoModeLive(flags) ? null : { code: "video-mode-not-live", message: SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE }
}
