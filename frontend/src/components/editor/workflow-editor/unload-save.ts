/**
 * What the editor does as the page unloads (its two `beforeunload` handlers),
 * lifted out of `workflow-editor-main.tsx` so it can be run in a test.
 *
 *  - `unloadSaveRequest`: the keepalive PATCH that saves a dirty workflow, or
 *    null when there is nothing to save (or it would only be refused).
 *  - `unloadNeedsPrompt`: whether the browser's leave prompt shows.
 *
 * Both write the pending review edits FIRST (`flushPendingReviews`), then read
 * the store. The review inspector writes its edits debounced, and its own
 * `pagehide` flush runs after these handlers have already read the store, so
 * without this the last edit before a reload is neither saved nor prompted for.
 */
import { flushPendingReviews } from "@/lib/edl-review/write-review"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { orderNodesParentFirst } from "./group-coords"

export interface UnloadSaveAuth {
  readonly projectId: string | undefined | null
  readonly supabaseUrl: string | undefined
  readonly supabaseKey: string | undefined
  readonly token: string | null
}

export interface UnloadSaveRequest {
  readonly url: string
  readonly init: RequestInit
}

/** The keepalive save of the workflow as it stands, or null when none is sent. */
export function unloadSaveRequest(auth: UnloadSaveAuth): UnloadSaveRequest | null {
  flushPendingReviews()
  if (!auth.projectId) return null
  const state = useWorkflowStore.getState()
  // Read-only (Studio) workflows must never be persisted from the editor.
  // Auto-layout routes through the controlled onNodesChange and flips
  // isDirty even for read-only workflows, so the isDirty check below is
  // not enough on its own — bail before building/PATCHing the payload.
  if (state.isReadOnly) return null
  // A write this workflow already refused would be refused again.
  if (isSaveRefused(state)) return null
  if (!state.isDirty || state.nodes.length === 0) return null

  const { supabaseUrl, supabaseKey, token } = auth
  const wfId = state.workflowId
  if (!supabaseUrl || !supabaseKey || !wfId || !token) return null

  const payload = {
    nodes: structuredClone(orderNodesParentFirst(state.nodes)),
    edges: structuredClone(state.edges),
    settings: {
      // MUST mirror the normal save in use-workflow-persistence.ts (~L534):
      // PostgREST PATCH REPLACES the whole `settings` JSONB column, so any
      // subfield omitted here is DESTROYED on unload. Omitting
      // presentationSettings + viewport silently wiped all published-app I/O
      // curation (inputItems/outputItems/cardMeta/view modes/share settings)
      // and the saved viewport whenever a tab was closed mid-edit.
      characterDefinitions: structuredClone(state.characterDefinitions),
      flowPromptTemplates: structuredClone(state.flowPromptTemplates),
      presentationSettings: structuredClone(state.presentationSettings),
      viewport: state.savedViewport,
    },
  }

  // Optimistic locking on the unload-flush: PostgREST treats each
  // query-string `<col>=eq.<v>` filter as an AND'd predicate, so
  // adding `&updated_at=eq.<loadedUpdatedAt>` mirrors the in-app
  // `.eq("updated_at", ...)` chain. If another device wrote first
  // the row no longer matches, the PATCH is a silent 0-row no-op
  // (better than overwriting remote with stale fields the user
  // never got a chance to merge). When loadedUpdatedAt is null we
  // fall back to last-write-wins — a brand-new workflow that has
  // never been saved has no version to lock against.
  const lockedAt = state.loadedUpdatedAt
  const url = lockedAt
    ? `${supabaseUrl}/rest/v1/workflows?id=eq.${wfId}&updated_at=eq.${encodeURIComponent(lockedAt)}`
    : `${supabaseUrl}/rest/v1/workflows?id=eq.${wfId}`

  return {
    url,
    init: {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
      keepalive: true,
    },
  }
}

/**
 * Whether the browser's leave prompt shows. Plain `isDirty`, refused saves
 * included: the browser's own prompt offers nothing it cannot honour, and an
 * accidental close is the one way to lose results that Clone & Remix could
 * still have kept.
 */
export function unloadNeedsPrompt(): boolean {
  flushPendingReviews()
  return useWorkflowStore.getState().isDirty
}
