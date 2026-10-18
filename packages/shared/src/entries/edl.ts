/**
 * `@nodaro/shared/edl` — The edit decision list contract: EDL, speaker layouts/tracks, multicam, camera switch, edit plans.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  COMBINE_TRANSITIONS,
  COMBINE_TRANSITION_IDS,
  PICKER_TO_COMBINE_TRANSITION,
  resolveSlideshowTransition,
  COMBINE_TRANSITION_GROUP_ORDER,
  COMBINE_TRANSITION_GROUP_LABELS,
  getCombineTransition,
  resolveXfadeName,
} from "../combine-transitions.js"
export type {
  CombineTransition,
  CombineTransitionGroup,
} from "../combine-transitions.js"
export {
  AUDIO_CROSSFADE_CURVES,
  AUDIO_CROSSFADE_CURVE_IDS,
  DEFAULT_AUDIO_CROSSFADE_CURVE_ID,
  getAudioCrossfadeCurve,
  resolveAudioCrossfadeCurve,
} from "../audio-crossfade-curves.js"
export type { AudioCrossfadeCurve } from "../audio-crossfade-curves.js"
// --- Smart-cut best-pair search windows (shared bound + clamp) ---
export * from "../smart-cut-windows.js"
// --- EDL: the edit decision list contract (podcast editing primitives).
//     Types + validators + pure remap/duration functions; structural only. ---
export * from "../edl.js"
export * from "../speaker-layouts.js"
export * from "../edl-multicam.js"
// Speaker tracks: the face-tracking result (box body + the node's descriptor) and its validators.
export * from "../speaker-tracks.js"
export * from "../camera-switch-contract.js"
// Speaker Map's result contract (which camera each speaker is on) and the override's ordinal keys.
export * from "../speaker-map-contract.js"
export * from "../edit-plan-contract.js"
// A person's review of an Edit Plan (`editedEdl`) and the one resolver that applies it.
export * from "../edit-plan-review.js"
