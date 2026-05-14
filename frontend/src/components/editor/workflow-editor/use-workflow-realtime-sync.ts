/**
 * Subscribes to Supabase Realtime UPDATE events on the currently-open
 * workflow row and applies an APPEND-ONLY diff into React Flow state.
 *
 * Why it exists
 * -------------
 * External writers (MCP / Film Director skill via update_workflow_json)
 * mutate `workflows.nodes` / `workflows.edges` directly in the database.
 * Without a Realtime subscription the user's open editor tab has no
 * signal that the canvas state changed, and they have to refresh to see
 * the new nodes. That breaks the Film Director pitch — "watch your film
 * studio build itself on your canvas while you talk to Claude."
 *
 * Append-only contract (v1)
 * -------------------------
 *   - Find nodes in payload.new whose id is NOT in current state -> APPEND
 *   - Find edges in payload.new whose id is NOT in current state -> APPEND
 *   - NEVER remove existing local nodes/edges
 *   - NEVER mutate existing local nodes/edges (positions, prompts, etc.)
 *
 * Why append-only: the Film Director flow only appends; that's the only
 * external-write case we need to solve right now. Full conflict resolution
 * (handling deletes, position updates from other tabs, etc.) is a v2
 * concern. The append-only contract preserves the local user's
 * in-progress edits, which are otherwise invisible to the database until
 * the next persistence flush.
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
 * Usage (must be inside a ReactFlowProvider scope so useReactFlow works
 * for the caller, even though this hook itself doesn't call useReactFlow):
 *
 *   const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();
 *   useWorkflowRealtimeSync({
 *     workflowId,
 *     getCurrentNodes: () => getNodes(),
 *     getCurrentEdges: () => getEdges(),
 *     onAppendNodes: (newNodes) => setNodes((nds) => [...nds, ...newNodes]),
 *     onAppendEdges: (newEdges) => setEdges((eds) => [...eds, ...newEdges]),
 *   });
 *
 * Stale-closure prevention
 * ------------------------
 * The `getCurrent*` callbacks are read fresh on every event — they are
 * NOT captured in the subscribe-effect's closure. The subscription is
 * built once per (workflowId, supabaseClient) pair and its handler dereferences
 * an internal ref to call the latest callback identity. Without this, the
 * diff would always run against the local state that was current at
 * subscribe time, never the live state, and the editor would re-append
 * the same nodes on every event after the first user edit.
 *
 * Race notes (out of scope for v1, documented for v2)
 * ----------------------------------------------------
 *   - Concurrent local edit + external append: the user's local edit
 *     persisted via the existing workflow-persistence loop will overwrite
 *     the external append on next flush. The user sees the external node
 *     temporarily then loses it on the next save. Mitigation belongs in
 *     the persistence layer (CRDT or last-write-wins-with-merge), not
 *     here.
 *   - Out-of-order events: Realtime guarantees per-row delivery order, so
 *     this is not a concern for a single workflow id.
 */
import { useEffect, useRef } from "react"
import type { Node, Edge } from "@xyflow/react"
import { createClient } from "@/lib/supabase"

interface RealtimeWorkflowRow {
  readonly id: string
  readonly nodes: readonly Node[] | null
  readonly edges: readonly Edge[] | null
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
   * Called with ONLY the newly-arrived nodes (filtered by id against
   * current state). Caller should append, not replace.
   */
  readonly onAppendNodes: (newNodes: Node[]) => void
  /**
   * Called with ONLY the newly-arrived edges (filtered by id against
   * current state). Caller should append, not replace.
   */
  readonly onAppendEdges: (newEdges: Edge[]) => void
}

/**
 * Subscribes to Realtime UPDATE events on `workflows` filtered by id.
 * See file-level docstring for the full append-only contract.
 */
export function useWorkflowRealtimeSync(
  params: UseWorkflowRealtimeSyncParams,
): void {
  const {
    workflowId,
    getCurrentNodes,
    getCurrentEdges,
    onAppendNodes,
    onAppendEdges,
  } = params

  // Stash the four callbacks in refs so the subscribe-effect's closure
  // never captures a stale identity. The subscription is built once per
  // workflowId and its event handler reads `.current` to invoke the
  // latest props on every event.
  const getCurrentNodesRef = useRef(getCurrentNodes)
  const getCurrentEdgesRef = useRef(getCurrentEdges)
  const onAppendNodesRef = useRef(onAppendNodes)
  const onAppendEdgesRef = useRef(onAppendEdges)

  // Update refs on every render — cheap, and guarantees the next event
  // sees the freshest callbacks regardless of how the caller passes them.
  getCurrentNodesRef.current = getCurrentNodes
  getCurrentEdgesRef.current = getCurrentEdges
  onAppendNodesRef.current = onAppendNodes
  onAppendEdgesRef.current = onAppendEdges

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

          // The payload's nodes/edges are JSONB arrays from the DB; they
          // can be null on a freshly-inserted row, an empty array, or
          // populated with workflow content. Diff each side independently
          // so a payload that only changed nodes still applies them even
          // if edges hasn't changed.

          const incomingNodes = Array.isArray(next.nodes) ? next.nodes : []
          if (incomingNodes.length > 0) {
            const currentNodes = getCurrentNodesRef.current()
            const currentNodeIds = new Set(currentNodes.map((n) => n.id))
            const newNodes: Node[] = []
            for (const node of incomingNodes) {
              if (!currentNodeIds.has(node.id)) {
                newNodes.push(node)
              }
            }
            if (newNodes.length > 0) {
              onAppendNodesRef.current(newNodes)
            }
          }

          const incomingEdges = Array.isArray(next.edges) ? next.edges : []
          if (incomingEdges.length > 0) {
            const currentEdges = getCurrentEdgesRef.current()
            const currentEdgeIds = new Set(currentEdges.map((e) => e.id))
            const newEdges: Edge[] = []
            for (const edge of incomingEdges) {
              if (!currentEdgeIds.has(edge.id)) {
                newEdges.push(edge)
              }
            }
            if (newEdges.length > 0) {
              onAppendEdgesRef.current(newEdges)
            }
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
