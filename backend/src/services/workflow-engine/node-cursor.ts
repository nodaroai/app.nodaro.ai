import { supabase } from "../../lib/supabase.js"

/**
 * Durable per-node polling cursors (migration 267).
 *
 * A polling source node has to remember where it got to across runs. The editor
 * persists that in the node's own data via autosave; a SCHEDULED run has no
 * editor, so without this store the orchestrator re-read the same starting
 * point every tick and reprocessed the same items — for Telegram Channel Feed,
 * republishing the same posts to a real audience on every interval.
 *
 * Writing back into `workflows.nodes` was rejected on purpose: a background job
 * patching the document the user is editing races the canvas and can drop their
 * edits. This is server state, so it lives in server-owned storage.
 *
 * Both calls are BEST-EFFORT by design. A cursor read that fails should not
 * fail a workflow — it degrades to "reprocess", which is the pre-existing
 * behavior, not a new failure. A cursor write that fails does the same. Neither
 * is worth taking a user's run down for.
 */

export type NodeCursorKind = "telegram-channel-feed"

/** Where this node got to last run, or undefined on first run / any failure. */
export async function readNodeCursor(
  workflowId: string | undefined,
  nodeId: string,
): Promise<number | undefined> {
  if (!workflowId) return undefined
  try {
    const { data, error } = await supabase
      .from("node_cursors")
      .select("cursor_value")
      .eq("workflow_id", workflowId)
      .eq("node_id", nodeId)
      .maybeSingle()

    if (error || !data) return undefined
    const value = Number(data.cursor_value)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
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
    const previous = await readNodeCursor(workflowId, nodeId)
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
