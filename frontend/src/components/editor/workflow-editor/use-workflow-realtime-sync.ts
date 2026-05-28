/**
 * Subscribes to Supabase Realtime UPDATE events on the currently-open
 * workflow row and applies them into React Flow state with a behavior
 * that depends on whether local state is clean or dirty.
 *
 * Why it exists
 * -------------
 * Two writer surfaces touch `workflows.nodes` / `workflows.edges`:
 *   1. The user's own editor (autosave via `use-workflow-persistence`).
 *   2. External writers — MCP / Film Director skill via
 *      `update_workflow_json`, OR the same user editing in another tab,
 *      another browser, or on their phone.
 *
 * Without a subscription the open editor never sees writes from (1) on
 * a different device or from (2) at all, and the user has to refresh.
 * That breaks both the Film Director pitch ("watch your film studio
 * build itself") and the more mundane multi-tab editing case
 * (deleting a node in one tab silently popping back when another tab
 * autosaves stale state).
 *
 * Reconcile contract (v2)
 * -----------------------
 * Each UPDATE payload carries the full new row (REPLICA IDENTITY FULL).
 *
 *   - If `payload.updated_at === loadedUpdatedAt`: the broadcast is our
 *     own save (or a version we've already applied) — skip entirely.
 *   - If local state is CLEAN (`isDirty === false`): apply as a full
 *     reconcile — replace nodes/edges with the payload, advance
 *     `loadedUpdatedAt`. This makes a passive tab snap to the latest
 *     DB state silently, killing the stale-state-resurrects-deleted-
 *     nodes class of bugs.
 *   - If local state is DIRTY: apply only ADDs (preserves both the
 *     Film Director live-canvas UX and the user's in-progress edits).
 *     Removes/updates from the broadcast are NOT applied — the user's
 *     local work would otherwise be silently overwritten. The caller
 *     should surface a "workflow updated elsewhere" banner via
 *     `onRemoteUpdatedAt` so the user knows their next save will land
 *     on top of the remote version (caught by optimistic locking in
 *     `use-workflow-persistence`).
 *
 * Pairs with the canvas animation hooks:
 *   - useNodeInsertAnimation (D1)  — fade-in on first mount per node id
 *   - useEdgeInsertAnimation (D2)  — stroke-draw on first mount per edge id
 *   - useCameraAutoPan         (D3) — viewport follows newly-added nodes
 *
 * Both D1 and D2 are id-keyed module-level Sets, and D3 keeps a per-instance
 * ref of seen ids — so appending a node/edge whose id wasn't previously
 * mounted naturally triggers all three animations without further wiring.
 *
 * Subscription scope
 * ------------------
 * The Postgres CDC filter (`id=eq.<workflowId>`) restricts events to the
 * single workflow row currently open in the editor. RLS continues to
 * apply on Realtime (Supabase enforces the same policies on the
 * broadcast), so the user only receives events for rows they can SELECT.
 *
 * Migration: supabase/migrations/115_workflows_realtime.sql adds
 *   ALTER TABLE workflows REPLICA IDENTITY FULL;
 *   ALTER PUBLICATION supabase_realtime ADD TABLE workflows;
 * REPLICA IDENTITY FULL is required so unchanged-TOAST JSONB columns
 * (`nodes`, `edges`) are emitted in the UPDATE WAL payload.
 *
 * Stale-closure prevention
 * ------------------------
 * The `getCurrent*` / `getIsDirty` / `getLoadedUpdatedAt` callbacks are
 * read fresh on every event — they are NOT captured in the subscribe-
 * effect's closure. The subscription is built once per (workflowId,
 * supabaseClient) pair and its handler dereferences refs to call the
 * latest callback identity. Without this, the diff would run against
 * the local state that was current at subscribe time, never the live
 * state, and the editor would re-append the same nodes on every event
 * after the first user edit.
 */
import { useEffect, useRef } from "react"
import type { Node, Edge } from "@xyflow/react"
import { createClient } from "@/lib/supabase"

interface RealtimeWorkflowRow {
  readonly id: string
  readonly nodes: readonly Node[] | null
  readonly edges: readonly Edge[] | null
  readonly updated_at: string | null
  /**
   * The full JSONB settings column: `{ characterDefinitions,
   * flowPromptTemplates, presentationSettings, viewport }`. Forwarded
   * to the reconcile callback so the store can re-apply more than just
   * the canvas nodes/edges (a remote character-name rename or
   * presentation-settings change would otherwise be silently overwritten
   * on this tab's next autosave). Tab-local fields like `viewport` are
   * intentionally NOT reconciled by the caller — each tab keeps its
   * own pan/zoom.
   */
  readonly settings: Record<string, unknown> | null
}

export interface UseWorkflowRealtimeSyncParams {
  /**
   * The id of the workflow row to subscribe to. When null/undefined the
   * hook is a no-op (no subscription is opened). Changing the id tears
   * down the existing subscription and opens a fresh one.
   */
  readonly workflowId: string | null | undefined
  /**
   * Returns the current React Flow nodes. Called on every event — do
   * NOT memoize the body to a stale snapshot. Recommended:
   *   getCurrentNodes: () => getNodes()
   */
  readonly getCurrentNodes: () => readonly Node[]
  /**
   * Returns the current React Flow edges. Same staleness contract as
   * getCurrentNodes.
   */
  readonly getCurrentEdges: () => readonly Edge[]
  /**
   * Returns whether local state has unsaved edits. Drives the choice
   * between full reconcile (clean) and append-only (dirty).
   */
  readonly getIsDirty: () => boolean
  /**
   * Returns the `updated_at` of the version this tab's local state was
   * last synced from. Used to short-circuit our own-broadcast echoes —
   * if the payload's `updated_at` matches, the broadcast is the result
   * of our own save (or a version we've already applied) and is
   * skipped.
   */
  readonly getLoadedUpdatedAt: () => string | null
  /**
   * Apply the broadcast as a full reconcile: replace local nodes/edges
   * (and `settings`-derived fields) with the payload and advance
   * `loadedUpdatedAt`. Only called when local state is clean. The
   * `settings` payload is forwarded verbatim — the caller picks which
   * subfields to apply (character definitions, flow prompt templates,
   * presentation settings) and which to leave tab-local (viewport).
   */
  readonly onReconcile: (args: {
    readonly nodes: Node[]
    readonly edges: Edge[]
    readonly updatedAt: string
    readonly settings: Record<string, unknown> | null
  }) => void
  /**
   * Append-only fallback when local state is dirty. Called with ONLY
   * the newly-arrived nodes (filtered by id against current state).
   */
  readonly onAppendNodes: (newNodes: Node[]) => void
  /**
   * Append-only fallback when local state is dirty. Called with ONLY
   * the newly-arrived edges (filtered by id against current state).
   */
  readonly onAppendEdges: (newEdges: Edge[]) => void
  /**
   * Called on every broadcast (after the own-echo skip) with the
   * payload's `updated_at`. Drives the "workflow updated elsewhere"
   * banner when local state is dirty — the caller compares against
   * `loadedUpdatedAt` to detect divergence.
   */
  readonly onRemoteUpdatedAt: (updatedAt: string) => void
}

/**
 * Subscribes to Realtime UPDATE events on `workflows` filtered by id.
 * See file-level docstring for the full reconcile-vs-append-only contract.
 */
export function useWorkflowRealtimeSync(
  params: UseWorkflowRealtimeSyncParams,
): void {
  const {
    workflowId,
    getCurrentNodes,
    getCurrentEdges,
    getIsDirty,
    getLoadedUpdatedAt,
    onReconcile,
    onAppendNodes,
    onAppendEdges,
    onRemoteUpdatedAt,
  } = params

  // Stash callbacks in refs so the subscribe-effect's closure never
  // captures a stale identity. The subscription is built once per
  // workflowId and its event handler reads `.current` to invoke the
  // latest props on every event.
  const getCurrentNodesRef = useRef(getCurrentNodes)
  const getCurrentEdgesRef = useRef(getCurrentEdges)
  const getIsDirtyRef = useRef(getIsDirty)
  const getLoadedUpdatedAtRef = useRef(getLoadedUpdatedAt)
  const onReconcileRef = useRef(onReconcile)
  const onAppendNodesRef = useRef(onAppendNodes)
  const onAppendEdgesRef = useRef(onAppendEdges)
  const onRemoteUpdatedAtRef = useRef(onRemoteUpdatedAt)

  // Update refs on every render — cheap, and guarantees the next event
  // sees the freshest callbacks regardless of how the caller passes them.
  getCurrentNodesRef.current = getCurrentNodes
  getCurrentEdgesRef.current = getCurrentEdges
  getIsDirtyRef.current = getIsDirty
  getLoadedUpdatedAtRef.current = getLoadedUpdatedAt
  onReconcileRef.current = onReconcile
  onAppendNodesRef.current = onAppendNodes
  onAppendEdgesRef.current = onAppendEdges
  onRemoteUpdatedAtRef.current = onRemoteUpdatedAt

  useEffect(() => {
    if (!workflowId) return

    const supabase = createClient()
    const channelName = `workflow:${workflowId}`

    const channel = supabase
      .channel(channelName)
      .on(
        // Cast through unknown because supabase-js's overload for the
        // "postgres_changes" listen type uses string-literal generics
        // that confuse TS when destructured at our call site.
        "postgres_changes" as never,
        {
          event: "UPDATE",
          schema: "public",
          table: "workflows",
          filter: `id=eq.${workflowId}`,
        },
        (payload: { new: RealtimeWorkflowRow | null }) => {
          const next = payload.new
          if (!next) return

          const incomingUpdatedAt = next.updated_at
          if (!incomingUpdatedAt) return

          // Skip our own save's broadcast (and any version already
          // applied). Without this short-circuit, every successful save
          // would briefly toggle remoteUpdatedAt and could re-trigger a
          // no-op reconcile.
          const localUpdatedAt = getLoadedUpdatedAtRef.current()
          if (incomingUpdatedAt === localUpdatedAt) return

          const incomingNodes = Array.isArray(next.nodes) ? (next.nodes as Node[]) : []
          const incomingEdges = Array.isArray(next.edges) ? (next.edges as Edge[]) : []
          // `typeof === "object"` is true for both objects AND arrays —
          // explicit `!Array.isArray` rejects accidental array shapes so
          // the per-field guards downstream don't have to.
          const incomingSettings =
            next.settings &&
            typeof next.settings === "object" &&
            !Array.isArray(next.settings)
              ? (next.settings as Record<string, unknown>)
              : null

          if (!getIsDirtyRef.current()) {
            // Clean local state — snap to remote. This is what kills the
            // stale-state-resurrects-deleted-nodes bug: a passive tab
            // sees a remote save and immediately drops any node ids that
            // are no longer present, so the next time *this* tab's
            // autosave runs (after some idle-time UI nudge) it can't
            // resurrect them. `reconcileFromRemote` itself clears
            // `remoteUpdatedAt`, so we skip the divergence-tracking call
            // below in this branch to avoid a wasted set→clear pair on
            // the store.
            onReconcileRef.current({
              nodes: incomingNodes,
              edges: incomingEdges,
              updatedAt: incomingUpdatedAt,
              settings: incomingSettings,
            })
            return
          }

          // Dirty local state — track the divergence (drives the banner)
          // and keep v1 append-only behavior so in-progress edits aren't
          // clobbered (and so MCP-added nodes still land for the Film
          // Director live-canvas demo). The banner + optimistic locking
          // on save handle the actual conflict.
          onRemoteUpdatedAtRef.current(incomingUpdatedAt)

          if (incomingNodes.length > 0) {
            const currentNodeIds = new Set(getCurrentNodesRef.current().map((n) => n.id))
            const newNodes = incomingNodes.filter((n) => !currentNodeIds.has(n.id))
            if (newNodes.length > 0) onAppendNodesRef.current(newNodes)
          }
          if (incomingEdges.length > 0) {
            const currentEdgeIds = new Set(getCurrentEdgesRef.current().map((e) => e.id))
            const newEdges = incomingEdges.filter((e) => !currentEdgeIds.has(e.id))
            if (newEdges.length > 0) onAppendEdgesRef.current(newEdges)
          }
        },
      )
      .subscribe()

    return () => {
      // removeChannel handles both an active subscription and one in
      // the middle of joining; safe to call regardless of state.
      supabase.removeChannel(channel)
    }
  }, [workflowId])
}
