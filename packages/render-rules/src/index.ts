/**
 * @nodaro/render-rules — what Nodaro's renderers accept, shared by the backend
 * (every ingress refuses with it before a reserve) and the editor (it judges a
 * render node's input before a run), and what a Render final runs (the run
 * set both the editor and the server derive, and how an app run lays its
 * finals). In-repo workspace package under the root license; never published
 * to npm.
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
