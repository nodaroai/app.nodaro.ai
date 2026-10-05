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
 * Reconcile contract (v3)
 * -----------------------
 * Each UPDATE payload carries the full new row (REPLICA IDENTITY FULL).
 *
 *   - If `payload.version <= loadedVersion` (both known): the broadcast is
 *     this tab's own save echo — possibly a LATE one that lands after a
 *     newer save already advanced the cursor — or an `updated_at`-only
 *     write (thumbnail, share toggle) with no content change. Skip.
 *     `updated_at` equality alone only recognised the echo of the LATEST
 *     save: with saves ~500 ms apart (the pre-Run save, the poll-start
 *     save, a job finishing) an older echo routinely arrived after the
 *     next save's response and read as "another device" — rewinding the
 *     canvas and the CAS token when clean, pausing autosave when dirty.
 *     Relies on `workflows.version` being bumped by the content trigger
 *     (migration 218): on an install without it every row sits at 1 and
 *     this rule skips every broadcast — the CAS in use-workflow-persistence
 *     is blind on such an install for the same reason.
 *   - If `payload.updated_at === loadedUpdatedAt`: same echo rule for rows
 *     that carry no version — skip entirely.
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
 * Who subscribes, and who polls (T85 / T86)
 * -----------------------------------------
 * A broadcast is the row AS STORED, pushed into the browser whether or not
 * the app uses it, and a studio production keeps its owner's drafts in that
 * row — the empty media slots and runs in flight on each scene, the drafts in
 * the bin, each take's voice plan (studio rulings T11 / T21 / T42). A `view`
 * reader may not hold any of it, and the row policies let them SELECT the row,
 * so they would receive every one of those broadcasts.
 *
 * So which of the two this canvas does is decided HERE, from the access its
 * load answered (`loadedAccess` in the workflow store, keyed by workflow id;
 * `mayHoldStoredRow`) — never by the caller:
 *   - `own` / `edit`: the subscription above, adopting each broadcast exactly
 *     as it always did. The server answers both of them the stored row anyway.
 *   - `view`, or no answer yet (the load is in flight, or it failed): NO
 *     subscription. While the tab is visible, every {@link
 *     VIEW_POLL_INTERVAL_MS} the canvas reads the row's content-free stamp
 *     (`updated_at, version`); when either moved it re-reads the content
 *     through the server's door (`readWorkflowContentFromServer`), which
 *     strips the owner's drafts for `view`, and reconciles that like a
 *     broadcast. Re-reads are coalesced to one in flight plus one trailing —
 *     enough, because each reads the row as it is then. A canvas that holds
 *     nothing yet (a load in flight, or one that failed) asks nothing: the
 *     load itself reads the row. Polling pauses while the tab is hidden and
 *     looks once as soon as it is visible again.
 *
 * The record does not stay the load's answer: while the canvas is open the
 * access is re-asked (T97, `use-workflow-access-recheck.ts`) and each answer is
 * written into the same record — the owner's own row excepted, which stays
 * `own` (`recheckedAccess`). One that says `view` or `none` closes the
 * subscription and starts the poll on the spot; one that says `own` or `edit`
 * opens it again.
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
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { mayHoldStoredRow, readWorkflowContentFromServer, type WorkflowContentRow } from "@/lib/workflow-content"
import { coalesced } from "./coalesced"
import { useWorkflowAccessRecheck } from "./use-workflow-access-recheck"

/** How often a `view` reader's visible canvas asks whether the row moved (T85). */
export const VIEW_POLL_INTERVAL_MS = 5_000

interface RealtimeWorkflowRow {
  readonly id: string
  readonly nodes: readonly Node[] | null
  readonly edges: readonly Edge[] | null
  readonly updated_at: string | null
  /** Monotonic content version (workflows.version, trigger-bumped). */
  readonly version?: number | null
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

/** The row's content-free stamp — all a `view` reader's poll ever reads. */
interface WorkflowStamp {
  readonly updatedAt: string | null
  readonly version: number | null
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
   * Returns the `workflows.version` this tab's local state was last
   * synced from — the CAS token of its next save — or null when unknown.
   * A broadcast at or below it is an echo of this tab's own writes (a
   * late one included) or a write that changed no content; both skip.
   */
  readonly getLoadedVersion: () => number | null
  /**
   * Whether a save for this workflow is in flight (`saveStatus === "saving"`).
   * While true, a broadcast at a version NEWER than `loadedVersion` is this
   * tab's OWN save's echo, arriving before the save's HTTP response advanced
   * `loadedVersion` — a large REPLICA-IDENTITY-FULL row echoes slowly over the
   * WAL. Skip it: otherwise it lands on the dirty branch, strands
   * `remoteUpdatedAt`, and freezes autosave (the durable "updated on another
   * device" loop). A genuine remote write in this window still 0-row-conflicts
   * our CAS on the next save and surfaces from the save response, so nothing is
   * lost. Optional; treated as never-in-flight when absent.
   */
  readonly getSaveInFlight?: () => boolean
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
    /** Monotonic content version (workflows.version) when present on the
     *  broadcast row — advances the store's CAS token on clean snaps. */
    readonly version?: number | null
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

/** A re-read row in the broadcast's own shape, so both reach the same reconcile. */
function asBroadcastRow(row: WorkflowContentRow): RealtimeWorkflowRow {
  return {
    id: row.id,
    nodes: Array.isArray(row.nodes) ? (row.nodes as Node[]) : null,
    edges: Array.isArray(row.edges) ? (row.edges as Edge[]) : null,
    updated_at: row.updated_at ?? null,
    version: row.version ?? null,
    settings:
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : null,
  }
}

/**
 * Keeps the open canvas in step with writes made elsewhere — by the row's
 * Realtime broadcasts, or by polling when this canvas may not hold the row as
 * stored. See the file-level docstring for both, and for the reconcile-vs-
 * append-only contract they share.
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
    getLoadedVersion,
    getSaveInFlight,
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
  const getLoadedVersionRef = useRef(getLoadedVersion)
  const getSaveInFlightRef = useRef(getSaveInFlight)
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
  getLoadedVersionRef.current = getLoadedVersion
  getSaveInFlightRef.current = getSaveInFlight
  onReconcileRef.current = onReconcile
  onAppendNodesRef.current = onAppendNodes
  onAppendEdgesRef.current = onAppendEdges
  onRemoteUpdatedAtRef.current = onRemoteUpdatedAt

  // Keeps that access current while the canvas is open (T97): every answer is
  // written into the same `loadedAccess` record, so `live` below follows it.
  useWorkflowAccessRecheck(workflowId)

  // Whether this canvas may hold the row as stored: by the access its load
  // answered, or a re-check since, read here rather than handed in, so no
  // caller can opt out.
  const live = mayHoldStoredRow(useWorkflowStore((s) => s.loadedAccess), workflowId)

  useEffect(() => {
    if (!workflowId) return

    const supabase = createClient()
    const channelName = `workflow:${workflowId}`

    /**
     * Whether this tab already holds the row's content: its own save's echo —
     * possibly a late one — or a write that changed no content. Reads only the
     * row's metadata, so it runs on a broadcast as it arrives, and on a re-read
     * row when that lands.
     */
    const alreadyHeld = (next: RealtimeWorkflowRow): boolean => {
      const incomingUpdatedAt = next.updated_at
      if (!incomingUpdatedAt) return true

      // Skip our own save's broadcasts — on the monotonic content
      // version first, so a LATE echo of an older own save (its
      // updated_at no longer equals the cursor, which a newer save has
      // already moved) is recognised as ours and not as another device.
      // An `updated_at`-only write (same version) changed no content and
      // has nothing to reconcile either.
      const localVersion = getLoadedVersionRef.current()
      if (typeof next.version === "number" && localVersion != null && next.version <= localVersion) return true

      // Own IN-FLIGHT save echo: while a save is on the wire (saveStatus ===
      // "saving"), a broadcast at a NEWER version is our own not-yet-
      // acknowledged write — its ~116KB REPLICA-IDENTITY-FULL echo beat the
      // HTTP response that advances `loadedVersion`. Skip it; letting it
      // reach the dirty branch strands `remoteUpdatedAt` and freezes
      // autosave (the durable "updated on another device" loop a large
      // scrape result triggers). A genuine remote write in this window still
      // 0-row-conflicts our next save's CAS and surfaces from the response.
      if (getSaveInFlightRef.current?.() && typeof next.version === "number" && localVersion != null && next.version > localVersion) return true

      // Rows without a version: the echo of the latest save only.
      // Without this short-circuit, every successful save would
      // briefly toggle remoteUpdatedAt and could re-trigger a no-op
      // reconcile.
      return incomingUpdatedAt === getLoadedUpdatedAtRef.current()
    }

    /** Apply a row this caller may hold — the reconcile contract in the file docstring. */
    const adopt = (next: RealtimeWorkflowRow, incomingUpdatedAt: string): void => {
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
          version: typeof next.version === "number" ? next.version : null,
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
    }

    // ---- `own` / `edit`: the row's Realtime broadcasts, adopted as they arrive.
    if (live) {
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
            if (!next || alreadyHeld(next)) return
            adopt(next, next.updated_at as string)
          },
        )
        .subscribe()

      return () => {
        // removeChannel handles both an active subscription and one in
        // the middle of joining; safe to call regardless of state.
        supabase.removeChannel(channel)
      }
    }

    // ---- `view`, or no answer yet: no subscription — poll the stamp (T85).
    // Cleared on teardown, so nothing that lands after the editor moved on
    // (another workflow, or the subscription once the load answers) is
    // painted onto it.
    let active = true
    // The stamp this canvas last acted on; until its first look, what it holds.
    let observed: WorkflowStamp | null = null
    let looking = false
    let timer: ReturnType<typeof setInterval> | null = null

    /** What this canvas holds, or null while it holds nothing (a load in flight, or one that failed). */
    const held = (): WorkflowStamp | null => {
      const updatedAt = getLoadedUpdatedAtRef.current()
      return updatedAt === null ? null : { updatedAt, version: getLoadedVersionRef.current() }
    }

    const reread = coalesced(async () => {
      try {
        const fresh = await readWorkflowContentFromServer(workflowId)
        if (!active || !fresh) return
        const row = asBroadcastRow(fresh.row)
        // Re-checked on arrival: this tab may have applied a newer write meanwhile.
        if (!alreadyHeld(row)) adopt(row, row.updated_at as string)
      } catch {
        // Forget what was seen, so the next look compares the row with what
        // the canvas holds and asks again.
        observed = null
      }
    }, () => active)

    const look = async (): Promise<void> => {
      if (looking || !held()) return
      looking = true
      try {
        const { data, error } = await supabase
          .from("workflows")
          .select("updated_at, version")
          .eq("id", workflowId)
          .maybeSingle()
        const holds = held()
        if (!active || error || !data || !holds) return
        const stamp: WorkflowStamp = {
          updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
          version: typeof data.version === "number" ? data.version : null,
        }
        const before = observed ?? holds
        observed = stamp
        if (stamp.updatedAt !== before.updatedAt || stamp.version !== before.version) reread()
      } catch {
        // A failed look changes nothing; the next one asks again.
      } finally {
        looking = false
      }
    }

    const resume = (): void => {
      if (timer !== null) return
      void look()
      timer = setInterval(() => void look(), VIEW_POLL_INTERVAL_MS)
    }
    const pause = (): void => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") pause()
      else resume()
    }

    if (document.visibilityState !== "hidden") resume()
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      active = false
      pause()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [workflowId, live])
}
