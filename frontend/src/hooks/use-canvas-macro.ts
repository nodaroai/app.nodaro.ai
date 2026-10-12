/**
 * The canvas face of the add-node macros (`lib/canvas-macros.ts`): the real
 * nodes inserted, wired and grouped as ONE undo step. Every place that creates
 * a node from a picked add-node entry calls `addNodeOrMacro` instead of the
 * store's `addNode`, which would refuse a macro (it has no node definition).
 */
import { toast } from "sonner"
import { flushPendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { mintNodeId, newNodeDefaultData, useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { isRunInProgress } from "@/components/editor/workflow-editor/clear-run-results"
import { isCanvasMacroOffered, isCanvasMacroType } from "@/lib/canvas-macros"
import { emitsVideo, planReframeMacro, videoOutputHandleOf, type ReframeVideoSource } from "@/lib/reframe-macro"
import type { SceneNodeType, WorkflowNode } from "@/types/nodes"

export type CanvasMacroOutcome = "added" | "refused" | "busy" | "read-only"

export interface CanvasMacroResult {
  readonly outcome: CanvasMacroOutcome
  /** The group the macro made, when it did. */
  readonly groupId?: string
}

/** Where a macro was opened from: the video output the user dragged from. */
export interface CanvasMacroSource {
  readonly nodeId: string
  readonly handleId: string
  readonly direction: "source" | "target"
}

/**
 * The video the macro should read: the output the menu was opened from when it
 * carries one, else the single selected node that has a video output (several
 * would be a guess, so none is wired and the group wears the "Wire a video"
 * badge instead). Undefined when there is none.
 */
export function macroVideoSource(
  nodes: readonly WorkflowNode[],
  from?: CanvasMacroSource,
): ReframeVideoSource | undefined {
  if (from) {
    if (from.direction !== "source") return undefined
    const node = nodes.find((n) => n.id === from.nodeId)
    return node && emitsVideo(node.type, from.handleId) ? { source: node.id, sourceHandle: from.handleId } : undefined
  }
  const candidates = nodes.filter((n) => n.selected && n.type !== "group" && videoOutputHandleOf(n))
  return candidates.length === 1
    ? { source: candidates[0].id, sourceHandle: videoOutputHandleOf(candidates[0]) }
    : undefined
}

export function insertCanvasMacro(
  type: string,
  position: { readonly x: number; readonly y: number },
  from?: CanvasMacroSource,
): CanvasMacroResult {
  const store = useWorkflowStore.getState()
  if (store.isReadOnly) return { outcome: "read-only" }
  if (isRunInProgress(store.nodes)) {
    toast.info(tx("reframe.busy"))
    return { outcome: "busy" }
  }
  // A stale menu, a shortcut or a script cannot add it before its price is set.
  if (type !== "reframe" || !isCanvasMacroOffered(type)) return { outcome: "refused" }
  const defaults = {
    transcribe: newNodeDefaultData("transcribe"),
    frames: newNodeDefaultData("speaker-frames"),
    view: newNodeDefaultData("speaker-view"),
  }
  if (!defaults.transcribe || !defaults.frames || !defaults.view) return { outcome: "refused" }
  // Its own undo step: close whatever step is still open.
  flushPendingUndoSnapshot()
  const out: { groupId?: string } = {}
  const changed = store.editGraph((graph) => {
    const taken = graph.nodes.map((n) => n.id)
    const ids = {
      group: mintNodeId(taken),
      transcribe: mintNodeId(taken),
      frames: mintNodeId(taken),
      view: mintNodeId(taken),
    }
    const plan = planReframeMacro(graph, {
      position,
      ids,
      defaults: { transcribe: defaults.transcribe!, frames: defaults.frames!, view: defaults.view! },
      video: macroVideoSource(graph.nodes, from),
    })
    out.groupId = plan.groupId
    return { nodes: plan.nodes, edges: plan.edges }
  })
  if (!changed || !out.groupId) return { outcome: "refused" }
  // Centre the viewport on it, as a node added from the menu is.
  useWorkflowStore.getState().onNodeCreated?.(out.groupId)
  return { outcome: "added", groupId: out.groupId }
}

/**
 * The one entry for "create what this add-node entry stands for at `position`":
 * a macro inserts its nodes, anything else is the store's `addNode`. Returns the
 * new node's id (the group's, for a macro), or undefined when nothing was made.
 */
export function addNodeOrMacro(
  type: SceneNodeType,
  position: { readonly x: number; readonly y: number },
  initialData?: Record<string, unknown>,
  from?: CanvasMacroSource,
): string | undefined {
  if (isCanvasMacroType(type)) return insertCanvasMacro(type, position, from).groupId
  return useWorkflowStore.getState().addNode(type, { ...position }, initialData)
}
