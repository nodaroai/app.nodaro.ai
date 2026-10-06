/**
 * The editor's two guards around a review (spec §6 item 12), both read off the
 * canvas and neither a run of its own:
 *
 *  - `renderOwnRunRefusal` (TA19 a): the render's own ▶, and any Run from here /
 *    Run selected that reaches the render without its Camera Switch.
 *    Behind Camera Switch it reads the switch's SAVED, pre-edit EDL, so once
 *    the plan holds edits it would preview the unedited cut. It refuses and
 *    points at Update preview, which runs the same set as Render final at
 *    proxy. Shown only with the stop-rule flag on (decided 2026-10-06): off,
 *    there is no Update preview to point at, so ▶ behaves as it always did.
 *  - `replanEditLosses` (TA2 item 3): a run that would re-execute an Edit Plan
 *    holding a review replaces it. The run asks first, naming what is lost
 *    (`replanLossBody`): for a Tighten review, the spans restored and dropped;
 *    for a clip set's review (R14 a, decided 2026-10-06), the clips dropped and
 *    the hooks edited.
 */
import {
  normalizeEdl,
  PREVIEW_RENDER_NODE_TYPES,
  renderPlanPath,
  resolveEditPlanOutput,
  type Edl,
  type EditedEdl,
  type RenderGraphEdge,
} from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { tx } from "@/lib/i18n"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import { keptSetOf, MANUAL_REASON, restoredOf } from "@/lib/edl-review/kept-set"

type Graph = { nodes: readonly WorkflowNode[]; edges: readonly WorkflowEdge[] }

const dataOf = (n: WorkflowNode): Record<string, unknown> => (n.data ?? {}) as Record<string, unknown>

/** The Edit Plan behind a render, when the person has reviewed its output. */
function reviewedPlanBehind(
  renderId: string,
  { nodes, edges }: Graph,
): { planId: string; passesOtherNodes: boolean; passThroughIds: readonly string[] } | null {
  const path = renderPlanPath(renderId, nodes, edges as readonly RenderGraphEdge[])
  if (!path) return null
  const plan = nodes.find((n) => n.id === path.planId)
  if (!plan) return null
  const { generatedJson, editedEdl } = dataOf(plan)
  if (generatedJson === undefined || resolveEditPlanOutput(generatedJson, editedEdl).status !== "applied") return null
  // Each hop's wire ends at the node that consumes it: every wire but the last
  // ends at a pass-through (Camera Switch) between the plan and the render.
  const passThroughIds = path.hops.slice(0, -1).map((h) => h.edge.target)
  return { planId: path.planId, passesOtherNodes: path.hops.length > 1, passThroughIds }
}

/**
 * The refusal for a run that reaches a render without the Camera Switch before
 * it, or null when it may run. `runIds` is what the run executes: the server
 * seeds a node outside it from its SAVED output, so a render whose Camera
 * Switch is not in the run previews the unedited cut. Defaults to the render
 * alone (its own ▶); Run from here / Run selected pass their set, and a run
 * that includes the Camera Switch reads the edited plan and is never refused.
 */
export function renderOwnRunRefusal(
  nodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  runIds: ReadonlySet<string> = new Set([nodeId]),
): string | null {
  if (!runtimePreviewStopRule()) return null
  const node = nodes.find((n) => n.id === nodeId)
  if (!node || !PREVIEW_RENDER_NODE_TYPES.has(node.type ?? "")) return null
  const reviewed = reviewedPlanBehind(nodeId, { nodes, edges })
  if (!reviewed?.passesOtherNodes) return null
  return reviewed.passThroughIds.every((id) => runIds.has(id)) ? null : tx("renderFinal.ownRunRefusal")
}

interface ReplanLossOf {
  readonly planId: string
  /** The plan node's label, for the dialog's sentence. */
  readonly label: string
}

/** What re-running an Edit Plan would replace. */
export type ReplanLoss =
  | (ReplanLossOf & {
      /** A Tighten review. */
      readonly kind: "edl"
      /** Plan-dropped spans the review keeps again. */
      readonly restored: number
      /** Spans the reviewer cut that the plan kept. */
      readonly dropped: number
    })
  | (ReplanLossOf & {
      /** A clip set's review. */
      readonly kind: "clips"
      /** Clips the reviewer dropped. */
      readonly dropped: number
      /** Clips whose hook the reviewer rewrote (an empty hook included). */
      readonly hooks: number
    })

/** The reviews a run of `runs` would replace: each Edit Plan in it that holds
 *  an applied review with something in it. */
export function replanEditLosses(runs: readonly WorkflowNode[]): ReplanLoss[] {
  const losses: ReplanLoss[] = []
  for (const node of runs) {
    if (node.type !== "edit-plan") continue
    const { generatedJson, editedEdl } = dataOf(node)
    if (generatedJson === undefined) continue
    if (resolveEditPlanOutput(generatedJson, editedEdl).status !== "applied") continue
    const label = typeof dataOf(node).label === "string" && dataOf(node).label ? (dataOf(node).label as string) : node.type ?? ""
    const edited = editedEdl as EditedEdl
    if (edited.kind === "clips") {
      const dropped = edited.clips.filter((d) => !d.keep).length
      const hooks = edited.clips.filter((d) => d.hook !== undefined).length
      if (dropped + hooks > 0) losses.push({ kind: "clips", planId: node.id, label, dropped, hooks })
      continue
    }
    const plan = normalizeEdl(generatedJson)
    const kept = keptSetOf({ ...plan, segments: edited.edl.segments as Edl["segments"] })
    const cuts = (edited.edl.dropped as ReadonlyArray<{ reason?: unknown }>).filter((d) => d.reason === MANUAL_REASON)
    losses.push({ kind: "edl", planId: node.id, label, restored: restoredOf(plan, kept).length, dropped: cuts.length })
  }
  return losses
}

/** The re-plan confirm's sentence for one loss, in the current language: "Re-running
 *  Find Clips replaces your review: 2 clips dropped, 1 hook edited" (R14 a). A
 *  count of zero is left out of a clip review's sentence. */
export function replanLossBody(loss: ReplanLoss): string {
  if (loss.kind === "edl") return tx("renderFinal.replanBody", { plan: loss.label, restored: loss.restored, dropped: loss.dropped })
  const parts: string[] = []
  if (loss.dropped > 0) {
    parts.push(tx(loss.dropped === 1 ? "renderFinal.replanClipsDroppedOne" : "renderFinal.replanClipsDroppedMany", { n: loss.dropped }))
  }
  if (loss.hooks > 0) {
    parts.push(tx(loss.hooks === 1 ? "renderFinal.replanClipsHooksOne" : "renderFinal.replanClipsHooksMany", { n: loss.hooks }))
  }
  return tx("renderFinal.replanClipsBody", { plan: loss.label, changes: parts.join(tx("common.listComma")) })
}
