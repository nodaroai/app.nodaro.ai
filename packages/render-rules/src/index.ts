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
