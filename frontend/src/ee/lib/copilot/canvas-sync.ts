/**
 * Make the canvas show what the copilot just wrote.
 *
 * The happy path is Supabase Realtime: `edit_workflow` writes the row, the
 * editor's realtime subscription applies it, and by the time the SSE
 * `workflow_updated` event is reduced the canvas is already at that version.
 * The fallback exists because Realtime is best-effort — a dropped socket or an
 * oversized payload would otherwise leave the chat claiming "Added 3 nodes"
 * over a canvas that shows none.
 */
import { getAuthHeaders } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { FOCUS_NODES_EVENT } from "@/lib/canvas-focus-event"

const REALTIME_GRACE_MS = 1_500
const POLL_MS = 150

function currentVersion(): number | null {
  return useWorkflowStore.getState().loadedVersion
}

function atLeast(version: number): boolean {
  const loaded = currentVersion()
  return typeof loaded === "number" && loaded >= version
}

/**
 * Resolves once the canvas is at `version` or newer.
 *
 * Returns how it got there so the caller can surface a stale canvas rather than
 * pretending: `"realtime"` | `"fetched"` | `"dirty"` (local edits block the
 * adoption — the editor's existing "updated elsewhere" banner owns that case) |
 * `"failed"`.
 */
export async function ensureCanvasVersion(
  workflowId: string,
  version: number,
  signal?: AbortSignal,
): Promise<"realtime" | "fetched" | "dirty" | "failed"> {
  if (atLeast(version)) return "realtime"

  const deadline = Date.now() + REALTIME_GRACE_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) return "failed"
    if (atLeast(version)) return "realtime"
    await sleep(POLL_MS)
  }
  if (atLeast(version)) return "realtime"

  // Realtime did not deliver. Adopting a remote graph over unsaved local edits
  // would silently discard them, so leave that to the editor's conflict banner.
  if (useWorkflowStore.getState().isDirty) return "dirty"

  try {
    const res = await fetch(`/v1/workflows/${encodeURIComponent(workflowId)}`, {
      headers: await getAuthHeaders(),
      signal,
    })
    if (!res.ok) return "failed"
    const body = (await res.json()) as {
      data?: {
        nodes?: WorkflowNode[]
        edges?: WorkflowEdge[]
        updatedAt?: string
        version?: number | null
        settings?: Record<string, unknown> | null
      }
    }
    const row = body.data
    if (!row || !Array.isArray(row.nodes) || !Array.isArray(row.edges)) return "failed"
    // Re-check: realtime may have landed while the request was in flight.
    if (atLeast(version)) return "realtime"
    if (useWorkflowStore.getState().isDirty) return "dirty"
    useWorkflowStore.getState().reconcileFromRemote({
      nodes: row.nodes,
      edges: row.edges,
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      version: typeof row.version === "number" ? row.version : null,
      settings: row.settings ?? null,
    })
    return "fetched"
  } catch {
    return "failed"
  }
}

/**
 * Ask the canvas to select and frame the nodes the copilot just added.
 *
 * Dispatched as a DOM event rather than called directly because selecting and
 * centering both need React Flow instance methods, which only exist inside
 * `workflow-canvas.tsx`. That listener is core code reacting to an event — no
 * core-to-ee import, and the canvas keeps sole ownership of viewport state.
 */
export function focusNodes(nodeIds: readonly string[]): void {
  if (nodeIds.length === 0) return
  window.dispatchEvent(new CustomEvent(FOCUS_NODES_EVENT, { detail: { nodeIds: [...nodeIds] } }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
