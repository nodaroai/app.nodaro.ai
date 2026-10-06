import { supabase } from "../../lib/supabase.js"

/**
 * Durable per-node polling cursors (migration 267).
 *
 * A polling source node has to remember where it got to across runs. The editor
 * used to persist that in the node's own data via autosave; a SCHEDULED run has
 * no editor, so without this store the orchestrator re-read the same starting
 * point every tick and reprocessed the same items — for Telegram Channel Feed,
 * republishing the same posts to a real audience on every interval.
 *
 * Writing back into `workflows.nodes` was rejected on purpose: a background job
 * patching the document the user is editing races the canvas and can drop their
 * edits. This is server state, so it lives in server-owned storage.
 *
 * ONE owner (decided 2026-10-05): the feed's ROUTE reads and advances the
 * cursor from the `workflowId` / `nodeId` the request carries — the editor's
 * single-node Run and a scheduled run move the same position, and the editor
 * no longer keeps a second cursor in the node's data. Every call is scoped to
 * the user whose run it is (`user_id`): a collaborator reads nothing of the
 * owner's position and writes a position of their own.
 *
 * The read and the write are BEST-EFFORT by design. A cursor read that fails
 * should not fail a workflow — it degrades to "reprocess", which is the
 * pre-existing behavior, not a new failure. A cursor write that fails does the
 * same. A RESET is a person's action and throws, so the UI can say so.
 */

export type NodeCursorKind = "telegram-channel-feed"

export interface NodeCursorRow {
  readonly value: number
  readonly updatedAt: string | null
}

/** The stored position with its timestamp, or undefined on first run / any failure. */
export async function readNodeCursorRow(
  workflowId: string | undefined,
  nodeId: string,
  userId: string,
): Promise<NodeCursorRow | undefined> {
  if (!workflowId) return undefined
  try {
    const { data, error } = await supabase
      .from("node_cursors")
      .select("cursor_value, updated_at")
      .eq("workflow_id", workflowId)
      .eq("node_id", nodeId)
      .eq("user_id", userId)
      .maybeSingle()

    if (error || !data) return undefined
    const value = Number(data.cursor_value)
    if (!Number.isFinite(value)) return undefined
    return { value, updatedAt: typeof data.updated_at === "string" ? data.updated_at : null }
  } catch {
    return undefined
  }
}

/** Where this node got to last run, or undefined on first run / any failure. */
export async function readNodeCursor(
  workflowId: string | undefined,
  nodeId: string,
  userId: string,
): Promise<number | undefined> {
  return (await readNodeCursorRow(workflowId, nodeId, userId))?.value
}

/**
 * Advance the cursor. Never moves BACKWARDS: a poll that returns an older
 * high-water mark (a deleted post, a partial fetch, an out-of-order retry) must
 * not rewind the cursor and cause everything since to be reprocessed.
 */
export async function writeNodeCursor(
  workflowId: string | undefined,
  nodeId: string,
  userId: string,
  kind: NodeCursorKind,
  cursorValue: number,
): Promise<void> {
  if (!workflowId || !Number.isFinite(cursorValue)) return
  try {
    const previous = await readNodeCursor(workflowId, nodeId, userId)
    if (previous !== undefined && cursorValue <= previous) return

    await supabase.from("node_cursors").upsert(
      {
        workflow_id: workflowId,
        node_id: nodeId,
        user_id: userId,
        kind,
        cursor_value: cursorValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workflow_id,node_id" },
    )
  } catch {
    // Best-effort: a failed write means the next run reprocesses, which is the
    // old behavior — not a reason to fail the user's workflow.
  }
}

/** Forget the position (the node's Reset): the next run starts from the newest posts again. True when a row was removed. */
export async function resetNodeCursor(workflowId: string, nodeId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("node_cursors")
    .delete()
    .eq("workflow_id", workflowId)
    .eq("node_id", nodeId)
    .eq("user_id", userId)
    .select("node_id")
  if (error) throw new Error(`node_cursors reset failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}
