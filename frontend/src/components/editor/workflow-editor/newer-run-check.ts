/**
 * Has a run ended that this canvas does not show (TA3 c)? ONE check for
 * Render final's precheck (render-final-handler.ts) and the review inspector's
 * open-time check (A3-2): both must load the newer run before they act, or a
 * final bills an older plan and a review edits one.
 *
 * Asked of the newest ended editor run, exactly as reopening loads it
 * (`newerRunPatches` with the reopen lane's `restoreEndedEditorRun`). A listing
 * that fails answers "no": a check that cannot be made never stops anything.
 *
 * Neither caller waits on it for more than `NEWER_RUN_CHECK_TIMEOUT_MS`
 * (decided 2026-10-07): past that, the run goes ahead with a warning that the
 * check was not made. An answer that lands later still counts until the run is
 * submitted (`startNewerRunCheck`).
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

/** How long a newer-run check holds a run before it goes ahead unchecked (decided 2026-10-07). */
export const NEWER_RUN_CHECK_TIMEOUT_MS = 15_000

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

/** Load the newer run's results onto the canvas; false when nothing was written (a read-only canvas). */
export function applyNewerRun(patches: NewerRunPatches): boolean {
  const { updateNodeData, isReadOnly } = useWorkflowStore.getState()
  // A read-only canvas takes no writes (updateNodeData returns early): say so.
  if (isReadOnly) return false
  for (const [id, data] of Object.entries(patches)) updateNodeData(id, data as Record<string, unknown>)
  return true
}

/** Tell the person a newer run exists, with the one click that loads it. */
export function refuseForNewerRun(patches: NewerRunPatches): void {
  toast.error(tx("renderFinal.newerRun"), {
    duration: 12_000,
    action: {
      label: tx("renderFinal.loadNewerRun"),
      onClick: () => {
        if (applyNewerRun(patches)) toast.success(tx("renderFinal.newerRunLoaded"))
      },
    },
  })
}

/** The check gave no answer within `NEWER_RUN_CHECK_TIMEOUT_MS`. */
export const NEWER_RUN_UNCHECKED = "unchecked" as const

export interface NewerRunCheck {
  /** The answer within the limit, or `NEWER_RUN_UNCHECKED` when the limit passed first. */
  readonly withinLimit: Promise<NewerRunPatches | null | typeof NEWER_RUN_UNCHECKED>
  /** The answer if it has landed by now, late or not; `undefined` while it is out. */
  readonly answer: () => NewerRunPatches | null | undefined
}

/**
 * `newerRunOnServer`, waited on for at most `timeoutMs`. The listing is never
 * cancelled: the caller reads `answer()` again just before it submits the run,
 * so a newer run that answers late still stops it. Nothing happens when the
 * answer lands, so one that lands after the run is submitted is ignored.
 */
export function startNewerRunCheck(
  workflowId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  timeoutMs: number = NEWER_RUN_CHECK_TIMEOUT_MS,
): NewerRunCheck {
  let answered: NewerRunPatches | null | undefined
  const listing = newerRunOnServer(workflowId, nodes, edges).then((patches) => {
    answered = patches
    return patches
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<typeof NEWER_RUN_UNCHECKED>((resolve) => {
    timer = setTimeout(() => resolve(NEWER_RUN_UNCHECKED), timeoutMs)
  })
  const withinLimit = Promise.race([listing, limit]).finally(() => clearTimeout(timer))
  return { withinLimit, answer: () => answered }
}
