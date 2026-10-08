/**
 * @nodaro/render-rules — what Nodaro's renderers accept, shared by the backend
 * (every ingress refuses with it before a reserve) and the editor (it judges a
 * render node's input before a run), and what a Render final runs (the run
 * set both the editor and the server derive, and how an app run lays its
 * finals), and how long a render is estimated at and how many times a clips plan
 * runs it, and how many times any node runs (the editor's run estimate and the stored listing), and the episode length the template gallery sorts at. In-repo workspace package under the root license;
 * never published to npm.
 */
export {
  APPLY_EDL_MAX_OUTPUT_MS,
  buildEffectiveEdl,
  effectiveRenderBasis,
  findEffectiveEdlIssues,
  validateEffectiveEdl,
  type ApplyEdlIssue,
  type ApplyEdlIssueCode,
  type ApplyEdlSourceIssueCode,
  type ApplyEdlValidation,
  type EffectiveEdlOptions,
} from "./apply-edl"
export {
  renderFinalRunSet,
  renderRunOverrides,
  rendersOfPlan,
  type RenderFinalGraphEdge,
  type RenderFinalGraphNode,
} from "./render-final-set"
export { appRunFinalReplacedIds, appRunFinalStates, FROM_RENDER_FINAL } from "./app-run-final"
export {
  ASSUMED_CLIP_TARGET_SEC,
  CLIP_LENGTH_HEADROOM,
  EDIT_PLAN_LEGACY_DURATION_KEYS,
  EDL_LENGTH_PRESERVING_TYPES,
  TRAILER_MAX_SEC,
  editPlanRenderEstimateLength,
  editPlanRenderEstimateMinutes,
  mediaLengthSecOf,
  persistedEdlPlan,
  inlineEdlMinutes,
  renderLengthCeilingMinutes,
  resolveApplyEdlEstimateLength,
  resolveApplyEdlEstimateMinutes,
  resolveEditPlanEpisodeSec,
  resolveEditPlanEstimateDurationSec,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
  withoutMediaLength,
  type RenderEstimateLength,
} from "./apply-edl-estimate"
export {
  clipFanOut,
  clipWireCarriesNothing,
  editPlanClipFanOut,
  heldBatchFanOut,
  inheritedClipFanOut,
  selectedFanOutCount,
  type FanOutGraphEdge,
} from "./clip-fan-out"
export {
  baseFanOut,
  EACH_WIRE_FAN_OUT,
  nodeFanOut,
  nodeProviders,
  PRODUCER_FAN_OUT,
  type ProducerFanOut,
} from "./node-fan-out"
export { TYPICAL_EPISODE_MINUTES, typicalEpisodeCredits } from "./typical-episode"
export {
  MULTI_SLOT_LAYOUTS,
  SPEAKER_VIEW_ACCENT_PATTERN,
  SPEAKER_VIEW_ASPECTS,
  SPEAKER_VIEW_DEFAULTS,
  SPEAKER_VIEW_DEFAULT_ASPECT,
  SPEAKER_VIEW_EMPHASIS_ATOMS,
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  SPEAKER_VIEW_MAX_OUTPUT_MS,
  SPEAKER_VIEW_MIN_REGION,
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  isSpeakerViewAspect,
  speakerViewRunRefusal,
  type SpeakerViewRunRefusal,
} from "./speaker-view-settings"
export {
  SPEAKER_VIEW_MAX_TWEEN_MS,
  isSpeakerViewSwitchDrawn,
  speakerViewSettingProblems,
  type SpeakerViewSettingProblem,
  type SpeakerViewSettings,
} from "./speaker-view-settings-check"
export {
  layOutSpeakerView,
  snapLayout,
  speakerOrder,
  speakerSources,
  speakerViewSlotSet,
  type SpeakerViewLayoutRequest,
  type SpeakerViewLayoutResult,
} from "./speaker-view-layout"
export {
  coerceSpeakerViewEdl,
  findSpeakerViewIssues,
  resolveSpeakerViewAspect,
  validateSpeakerView,
  type SpeakerViewIssue,
  type SpeakerViewIssueCode,
  type SpeakerViewRefusal,
  type SpeakerViewRuleInput,
  type SpeakerViewVerdict,
} from "./speaker-view-rule"
export { speakerViewContext, type SpeakerViewClip, type SpeakerViewContext } from "./speaker-view-context"
export {
  SPEAKER_VIEW_BASIC_SWITCHES,
  SPEAKER_VIEW_CROSSFADE_ID,
  normalizeSpeakerViewData,
  speakerViewAspectOf,
  speakerViewDefaultsFor,
  validSpeakerCrossfade,
  validSpeakerEmphasis,
  validSpeakerLayouts,
  validSpeakerSwitches,
  type SpeakerViewNodeSettings,
  type SpeakerViewNormalizeNote,
  type SpeakerViewOption,
  type SpeakerViewReason,
  type SpeakerViewReasonCode,
} from "./speaker-view-options"
export {
  defaultSpeakerRegions,
  speakerViewRenderBasis,
  speakerViewWireSettings,
  type SpeakerViewWireSettings,
} from "./speaker-view-wire"
export {
  knownLength,
  LENGTH_PRICED_UTILITY_TYPES,
  runWireLengthSec,
  utilityOutputLength,
  videoSfxClipSec,
  type InputLength,
  type RunWireLengthOptions,
  type WireLength,
} from "./utility-wire-length"
