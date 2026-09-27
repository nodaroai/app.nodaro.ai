import { PROJECTED_TRIGGER_NODE_TYPES } from "@nodaro/shared"
import { syncWorkflowTriggers } from "@/lib/api"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * After a save, the editor asks the server to project trigger nodes onto real
 * trigger rows. The editor saves through PostgREST, which never runs that
 * projection (#1566), so this is the one place an editor-made schedule
 * becomes a schedule — and where a removed one is synced away.
 *
 * A per-workflow tracker remembers the trigger set the server last agreed to
 * (a fingerprint of the trigger nodes' ids + data), so:
 * - a save that changed nothing about the triggers makes no request (nearly
 *   every autosave tick) — except the FIRST time a workflow with trigger nodes
 *   is saved in a session, which syncs once so a graph whose nodes never had
 *   rows (the installed base #1566 left behind) is repaired by any save;
 * - the "before" side never goes stale on the full-save path, where the
 *   store's saved snapshot is not advanced;
 * - the ids it VOUCHES for — the server stamps `owner_initiated` only for
 *   those — are the trigger nodes this session added: absent from what the
 *   server last agreed to AND absent from the stored graph the save started
 *   from. A node that arrived in the stored graph from anyone else (a token's
 *   write adopted by realtime or a reload) is in that stored graph, so it is
 *   projected plain, never vouched;
 * - a failed sync is retried on the next save, still vouching for the ids
 *   this session added (they are remembered until a sync succeeds);
 * - overlapping syncs coalesce: a save that lands while one is in flight is
 *   run right after it, not raced (two reconciles could both create) — and
 *   what that save added is remembered too, because a later save's stored
 *   graph already contains it and would otherwise erase the vouch.
 *
 * The second half of the anti-laundering invariant lives in the save itself:
 * a foreign write bumps the workflow's version, so the owner's next save
 * either conflicts or rebases and adopts the foreign node into the saved
 * snapshot BEFORE this runs. A save lane that skipped that check would let a
 * node appended into a dirty canvas by realtime be counted as "added".
 */
type NodeLike = { readonly id?: unknown; readonly type?: unknown; readonly data?: unknown }
type Graph = ReadonlyArray<NodeLike> | null | undefined

export interface TriggerFingerprint {
  readonly signature: string
  readonly ids: ReadonlySet<string>
}

export const NO_TRIGGERS: TriggerFingerprint = { signature: "", ids: new Set() }

/** The server refuses a longer list; a graph with that many trigger nodes is not a real one. */
const MAX_VOUCHED_IDS = 200

export function graphHasProjectedTriggers(nodes: Graph): boolean {
  return (nodes ?? []).some((n) => typeof n.type === "string" && PROJECTED_TRIGGER_NODE_TYPES.has(n.type))
}

/** What the server would project from this graph: the trigger nodes, by id, with their data. */
export function triggerFingerprint(nodes: Graph): TriggerFingerprint {
  const triggers = (nodes ?? [])
    .filter((n) => typeof n.type === "string" && PROJECTED_TRIGGER_NODE_TYPES.has(n.type) && typeof n.id === "string")
    .map((n) => [n.id as string, n.type as string, n.data ?? null] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  if (triggers.length === 0) return NO_TRIGGERS
  return { signature: JSON.stringify(triggers), ids: new Set(triggers.map((t) => t[0])) }
}

export type TriggerSyncOutcome = "skipped" | "synced" | "failed" | "deferred"

/** One per workflow id; a React ref holds them. Mutable on purpose — it IS the ref's contents. */
export interface TriggerSyncTracker {
  /** The trigger set the server last agreed to; `null` until the first sync of the session. */
  lastSynced: TriggerFingerprint | null
  /** Ids this session added that no sync has confirmed yet — vouched again on the retry. */
  pendingVouch: ReadonlySet<string>
  /** What the in-flight sync is vouching for, so a deferred save does not re-add them. */
  inFlightVouch: ReadonlySet<string>
  pendingRetry: boolean
  inFlight: boolean
  /** A save that landed while a sync was in flight; run right after it. */
  deferred: { readonly nodesBefore: Graph; readonly nodesAfter: Graph } | null
}

export function createTriggerSyncTracker(): TriggerSyncTracker {
  return { lastSynced: null, pendingVouch: new Set(), inFlightVouch: new Set(), pendingRetry: false, inFlight: false, deferred: null }
}

/**
 * Best-effort and off the save's critical path: the save has already landed,
 * and a sync hiccup must not turn it into an error — `onFailure` lets the
 * caller say so, and the next save retries.
 *
 * @param nodesBefore the stored graph this save started from (the store's
 *   saved snapshot). It decides what this session may vouch for; it also
 *   stands in for "what the server last agreed to" until a sync succeeds.
 */
export async function syncTriggersAfterSave(
  tracker: TriggerSyncTracker,
  workflowId: string,
  nodesBefore: Graph,
  nodesAfter: Graph,
  /** `reason` is the server's user-facing explanation when it has one (a
   *  Telegram bot it could not register); absent for a plain failure. */
  onFailure?: (reason?: string) => void,
): Promise<TriggerSyncOutcome> {
  const stored = triggerFingerprint(nodesBefore)
  const agreed = tracker.lastSynced ?? stored
  const after = triggerFingerprint(nodesAfter)

  const unchanged = agreed.signature === after.signature && !tracker.pendingRetry
  // The first sync of a workflow that carries triggers is never skipped: its
  // nodes may have no rows at all (a graph saved before the editor projected).
  const firstOpenWithTriggers = tracker.lastSynced === null && after.signature !== ""
  if (unchanged && !firstOpenWithTriggers) {
    tracker.lastSynced = after
    return "skipped"
  }
  const added = [...after.ids].filter((id) => !agreed.ids.has(id) && !stored.ids.has(id))
  if (tracker.inFlight) {
    // Only the latest deferred save is replayed, and by then the stored graph
    // may already contain what THIS save added — keep its vouch alive.
    const mine = added.filter((id) => !tracker.inFlightVouch.has(id))
    tracker.pendingVouch = new Set([...tracker.pendingVouch, ...mine])
    tracker.deferred = { nodesBefore, nodesAfter }
    return "deferred"
  }

  const vouchNodeIds = [...new Set([...tracker.pendingVouch, ...added])].filter((id) => after.ids.has(id)).slice(0, MAX_VOUCHED_IDS)

  tracker.inFlight = true
  tracker.inFlightVouch = new Set(vouchNodeIds)
  let refusalReason: string | undefined
  try {
    const result = await syncWorkflowTriggers(workflowId, vouchNodeIds)
    if (!result.data.synced) {
      refusalReason = result.data.reason
      throw new Error("sync refused")
    }
    tracker.lastSynced = after
    // The rows changed: a Webhook Trigger's URL (read from its row) appears
    // in the editor as soon as the save that created it lands.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflows.triggers(workflowId) })
    // Confirmed: what this sync vouched for. Anything a save added WHILE it
    // was in flight is still pending, for the chained run.
    tracker.pendingVouch = new Set([...tracker.pendingVouch].filter((id) => !tracker.inFlightVouch.has(id)))
    tracker.pendingRetry = false
    return "synced"
  } catch {
    tracker.pendingVouch = new Set([...tracker.pendingVouch, ...vouchNodeIds])
    tracker.pendingRetry = true
    onFailure?.(refusalReason)
    return "failed"
  } finally {
    tracker.inFlight = false
    tracker.inFlightVouch = new Set()
    const deferred = tracker.deferred
    tracker.deferred = null
    if (deferred) void syncTriggersAfterSave(tracker, workflowId, deferred.nodesBefore, deferred.nodesAfter, onFailure)
  }
}
