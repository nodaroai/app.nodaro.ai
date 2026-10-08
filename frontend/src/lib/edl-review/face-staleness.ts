/**
 * "Edited since this preview" on a render's node face (A3-5, U1): the Edit
 * Plan behind the render holds an applied edit AND the take on show is not cut
 * from the plan as it stands.
 *
 * The comparison is the inspector's own (`isFreshTake` over the bases a run with
 * its pass-through nodes would stamp now: staleness.ts), so this note and the
 * inspector's stale-preview banner never disagree. A take with no stamp it needs
 * (made before the stamps, or behind a Camera Switch that did not run with it)
 * is unknown, and an unknown take reads as stale once the plan holds an edit,
 * exactly as it does in the banner. With no edit nothing was "edited", so the
 * note stays quiet however old the take.
 *
 * A Tighten note only (§2.7, U1). A clip set's review (Keep, hooks: A4-2) changes
 * no clip's cut, and the render's node face shows ONE take of a batch, which
 * the first clip's basis below cannot judge: the Clip Pack inspector judges each
 * card by its own clip. So a clip set never reads as "edited since".
 *
 * Cheap where it is asked: the stamps are only computed once an edit applies and
 * a take exists.
 */
import { renderPlanPath, resolveEditPlanOutput, savedRenderOutput, type RenderGraphEdge } from "@nodaro/shared"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { currentRenderPlanBasis } from "@/components/editor/workflow-editor/apply-edl-stamps"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { planKindOf } from "./plan-kind"
import { isFreshTake, renderSettingsBasisOf, showsStaleTake } from "./staleness"

export function editedSincePreview(
  renderId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): boolean {
  const render = nodes.find((n) => n.id === renderId)
  if (!render) return false
  const take = savedRenderOutput(render.data as Readonly<Record<string, unknown>>)
  if (!take) return false
  const path = renderPlanPath(renderId, nodes, edges as readonly RenderGraphEdge[])
  const plan = path && nodes.find((n) => n.id === path.planId)
  if (!plan) return false
  const data = plan.data as Readonly<Record<string, unknown>>
  if (planKindOf(data.generatedJson) !== "edl") return false
  if (resolveEditPlanOutput(data.generatedJson, data.editedEdl).status !== "applied") return false

  const first = resolveApplyEdlRenders(render, nodes, edges)[0]
  const now = {
    planBasis: currentRenderPlanBasis(renderId, nodes, edges as readonly RenderGraphEdge[], first?.row),
    renderBasis: renderSettingsBasisOf(first, applyEdlRenderSettings(render.data as Record<string, unknown>)),
  }
  return showsStaleTake(isFreshTake(take, now), true, true)
}
