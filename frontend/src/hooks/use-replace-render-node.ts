/**
 * The canvas face of `lib/replace-render-node.ts` (SV16 b): the swap applied to
 * the live graph as ONE undoable edit, and what it did said in a toast that
 * carries its Undo — the same contract as "Clear results"
 * (`workflow-editor/clear-results-action.ts`). Undo restores the old node with
 * its run history; its id is gone from the canvas until then. The published
 * app's items that name the old node move to the new one in the same write,
 * and the swap is recorded so Undo and Redo take them along
 * (`lib/presentation-node-id.ts`).
 */
import { useMemo } from "react"
import { toast } from "sonner"
import { flushPendingUndoSnapshot, pendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { useUndoRedoStore, type WorkflowSnapshot } from "@/hooks/use-undo-redo-store"
import { mintNodeId, newNodeDefaultData, useWorkflowStore, type PresentationSettings } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { isRunInProgress } from "@/components/editor/workflow-editor/clear-run-results"
import {
  planRenderSwap,
  replaceRenderNode,
  type RenderSwapCheck,
  type RenderSwapRefusal,
  type RenderSwapResult,
  type RenderSwapWire,
} from "@/lib/replace-render-node"
import { NODE_DEFINITIONS, type SceneNodeType, type WorkflowNode } from "@/types/nodes"

export type RenderSwapOutcome = "replaced" | "refused" | "busy" | "read-only"

/** How long the confirmation (and its Undo) stays up. */
const UNDO_TOAST_MS = 10_000

/** More steps than the history holds — a bound, so the loop can never spin. */
const MAX_UNDO_STEPS = 60

/** A node type's display name ("Speaker View"). */
export const renderTypeLabel = (type: string): string => NODE_DEFINITIONS.find((d) => d.type === type)?.label ?? type

const nodeLabel = (nodes: readonly WorkflowNode[], id: string): string => {
  const n = nodes.find((x) => x.id === id)
  const label = (n?.data as { label?: unknown } | undefined)?.label
  return typeof label === "string" && label.trim() ? label : n?.type ? renderTypeLabel(n.type) : id
}

/** One wire as the person sees it: "Cam A → sources", "json → Add Captions",
 *  and a moved one as "Add Captions: json → transcript". */
export function describeWire(nodes: readonly WorkflowNode[], w: RenderSwapWire & { readonly to?: string }): string {
  const other = nodeLabel(nodes, w.nodeId)
  if (w.to !== undefined) return `${other}: ${w.handle} → ${w.to}`
  return w.direction === "in" ? `${other} → ${w.handle}` : `${w.handle} → ${other}`
}

/** Why a swap is refused, in the person's words. */
export function renderSwapRefusalText(reason: RenderSwapRefusal, fromType: string, toType: string): string {
  const vars = { from: renderTypeLabel(fromType), to: renderTypeLabel(toType) }
  if (reason === "medium") return tx("renderSwap.refusedMedium", vars)
  if (reason === "cameras-from-sources") return tx("renderSwap.refusedCameras", vars)
  return tx("renderSwap.refusedOther", vars)
}

/** What swapping `nodeId` to `toType` would do now, kept current with the canvas. */
export function useRenderSwapPlan(nodeId: string | undefined, toType: string): RenderSwapCheck | null {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const presentation = useWorkflowStore((s) => s.presentationSettings)
  return useMemo(
    () => (nodeId ? planRenderSwap(nodeId, nodes, edges, toType, presentation) : null),
    [nodeId, nodes, edges, toType, presentation],
  )
}

/** Take the canvas back to exactly before the swap (see `undoClear`). */
function undoSwap(step: WorkflowSnapshot | null, undo: () => void, fromLabel: string): void {
  flushPendingUndoSnapshot()
  if (!step) {
    undo()
    return
  }
  let steps = 0
  while (steps < MAX_UNDO_STEPS && useUndoRedoStore.getState().past.includes(step)) {
    undo()
    steps++
  }
  if (steps === 0) toast.info(tx("renderSwap.undoGone"))
  else if (steps > 1) toast.info(tx("renderSwap.undoTookLater", { from: fromLabel, n: steps - 1 }))
}

/**
 * Replace node `nodeId` with a new `toType` node on the live canvas. Refused
 * (with a toast) on a read-only canvas, while a run is in progress (it would
 * repaint the old id under the swap), and whenever `planRenderSwap` refuses.
 */
export function replaceRenderNodeOnCanvas(nodeId: string, toType: string, undo: () => void): RenderSwapOutcome {
  const store = useWorkflowStore.getState()
  if (store.isReadOnly) return "read-only"
  if (isRunInProgress(store.nodes)) {
    toast.info(tx("renderSwap.busy"))
    return "busy"
  }
  const old = store.nodes.find((n) => n.id === nodeId)
  const fromType = old?.type ?? ""
  const defaults = newNodeDefaultData(toType as SceneNodeType)
  if (!old || !defaults) {
    toast.error(tx("renderSwap.refusedOther", { from: renderTypeLabel(fromType), to: renderTypeLabel(toType) }))
    return "refused"
  }
  const fromLabel = nodeLabel(store.nodes, nodeId)

  // The swap must be its own undo step: close whatever step is still open.
  flushPendingUndoSnapshot()

  // Read and written inside the one store update (an object, so the result
  // is not narrowed away by the callback).
  const swap: { id?: string; result?: RenderSwapResult; before: readonly WorkflowNode[] } = { before: store.nodes }
  store.editGraph((graph) => {
    swap.before = graph.nodes
    swap.id = mintNodeId(graph.nodes.map((n) => n.id))
    swap.result = replaceRenderNode(graph, nodeId, toType, { id: swap.id, data: defaults }, graph.presentationSettings)
    if (!swap.result.ok) return null
    return {
      nodes: swap.result.nodes,
      edges: swap.result.edges,
      presentationSettings: swap.result.presentationSettings as PresentationSettings,
      nodeIdMove: [nodeId, swap.id] as const,
    }
  })
  const result = swap.result
  if (!result || !result.ok || !swap.id) {
    toast.error(renderSwapRefusalText(result && !result.ok ? result.reason : "not-a-render", fromType, toType))
    return "refused"
  }
  const newId = swap.id
  const dropped = result.plan.dropped
  const before = swap.before

  // The step stays OPEN: anything the canvas writes in reaction joins it.
  const step = pendingUndoSnapshot()
  if (useWorkflowStore.getState().selectedNodeId === nodeId) useWorkflowStore.getState().selectNode(newId)

  const wires = dropped.map((w) => describeWire(before, w)).join(", ")
  toast.success(tx("renderSwap.done", { from: fromLabel, to: renderTypeLabel(toType) }), {
    description: dropped.length > 0 ? tx("renderSwap.doneDropped", { wires }) : tx("renderSwap.doneKept", { from: fromLabel }),
    duration: UNDO_TOAST_MS,
    action: { label: tx("ctb.undo"), onClick: () => undoSwap(step, undo, fromLabel) },
  })
  return "replaced"
}
