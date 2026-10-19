/**
 * `@nodaro/sdk/edit` — the `edit` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export type {
  // Editorial (podcast-editing) contract used by the `edit` resource: the EDL
  // and transcript shapes, the edit-plan mode/tier vocabularies, and the raw
  // `output_data` shapes of the clips / chapters modes.
  Edl,
  Transcript,
  EditPlanMode,
  EditPlanTier,
  EdlClipSet,
  ChapterSet,
  SpeakerMapResult
} from "@nodaro/shared/edl"

// `unwrapEditPlanOutput` (value) — the sanctioned way to read an edit-plan job's
// `output_data` (normalizes clips → bare `Edl[]` and strips `viaNodaroCloud`).
export { unwrapEditPlanOutput } from "@nodaro/shared/edl"

export { CLIP_PACK_MAX_TARGET_SEC, CLIP_PACK_MIN_TARGET_SEC, EditResource, TRAILER_FORMATS, USE_CASE_NODE_TYPES } from "../resources/edit.js"

export type {
  EditJobResult,
  SilenceDetectInput,
  AudioSyncInput,
  AudioSyncSource,
  AudioSyncOffset,
  AudioSyncResult,
  ApplyEdlInput,
  EditPlanInput,
  EditPlanSource,
  CameraSwitchInput,
  SilenceRanges,
  ClipPackEmphasis,
  ClipPackInput,
  EpisodeChaptersInput,
  EpisodeTrailerInput,
  TrailerFormat,
  TightenEpisodeInput,
  TightenEpisodeJobResult,
  TightenEpisodeEstimate,
  UseCaseContinueInput,
  UseCaseEstimate,
  UseCaseJobResult,
  UseCaseNodeType,
  UseCaseRequestOptions,
} from "../resources/edit.js"

export type { SpeakerMapInput, SpeakerMapSource } from "../resources/speaker-map-inputs.js"
