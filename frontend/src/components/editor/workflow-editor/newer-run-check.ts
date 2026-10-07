/**
 * Has a run ended that this canvas does not show (TA3 c)? ONE check for
 * Render final's precheck (render-final-handler.ts) and the review inspector's
 * open-time check (A3-2): both must load the newer run before they act, or a
 * final bills an older plan and a review edits one.
 *
 * Asked of the newest ended editor run, exactly as reopening loads it
 * (`newerRunPatches` with the reopen lane's `restoreEndedEditorRun`). A listing
 * that fails answers "no": a check that cannot be made never stops anything.
 */
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { listWorkflowExecutions } from "@/lib/api"
import { tx } from "@/lib/i18n"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { newerRunPatches } from "./render-final-checks"
import type { ListedRun } from "./newer-run-review"

/** What loading the newer run changes on the render's EDL path, as
 *  `{ nodeId: newData }`; null when there is nothing newer (or no answer). */
export type NewerRunPatches = Record<string, WorkflowNode["data"]>

export async function newerRunOnServer(
  workflowId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): Promise<NewerRunPatches | null> {
  try {
    // Loaded on demand: the persistence hook is a heavy module this click path
    // should not drag into every editor surface that imports the run handlers.
    const { TERMINAL_RESTORABLE_STATUSES, restoreEndedEditorRun } = await import("@/hooks/use-workflow-persistence")
    const { data } = await listWorkflowExecutions(workflowId, { limit: 10, status: TERMINAL_RESTORABLE_STATUSES, source: "editor" })
    const patches = newerRunPatches(nodes, edges, data as unknown as readonly ListedRun[], restoreEndedEditorRun)
    return Object.keys(patches).length > 0 ? patches : null
  } catch {
    return null
  }
}

/** Load the newer run's results onto the canvas. */
export function applyNewerRun(patches: NewerRunPatches): void {
  const { updateNodeData } = useWorkflowStore.getState()
  for (const [id, data] of Object.entries(patches)) updateNodeData(id, data as Record<string, unknown>)
}

/** Tell the person a newer run exists, with the one click that loads it. */
export function refuseForNewerRun(patches: NewerRunPatches): void {
  toast.error(tx("renderFinal.newerRun"), {
    duration: 12_000,
    action: {
      label: tx("renderFinal.loadNewerRun"),
      onClick: () => {
        applyNewerRun(patches)
        toast.success(tx("renderFinal.newerRunLoaded"))
      },
    },
  })
}
