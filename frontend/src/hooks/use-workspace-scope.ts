import { useSyncExternalStore } from "react"
import { hasOrganizations } from "@/lib/edition"
import { workspaceStore } from "@/lib/workspace-context"

/**
 * Which scope this render is reading: a workspace, or the personal space.
 *
 * Core, not `ee/` — the query hooks that need it are core, and core may not
 * import from `ee/`. The React bindings in `ee/hooks/use-workspace.ts` are for
 * the organization SURFACES (switcher, console, vocabulary); this is the one
 * fact every list needs and nothing else.
 *
 * Both halves of a scoped query must come from HERE, in the same render:
 * `workspaceId` goes into the cache key AND into the filter. Reading the store
 * separately in each place is how a cache entry ends up labelled one workspace
 * while holding another's rows — the key would be computed at render and the
 * filter at fetch, and a switch in between makes them disagree.
 */
export interface WorkspaceScope {
  /** The active workspace, or null for the personal space. */
  readonly workspaceId: string | null
  /**
   * Whether the selection has settled.
   *
   * A remembered workspace lives in this browser's storage but is not trusted
   * until the server confirms the caller still belongs to it, so for the first
   * moments of a reload the answer is honestly "not known yet" rather than
   * "personal". Queries hold rather than run — otherwise every reload inside a
   * class fetches and paints the person's PRIVATE work first, then replaces it
   * once the class resolves.
   *
   * Always true when organizations are off: there is nothing to wait for, and
   * a hook that held forever would freeze every list on every other edition.
   */
  readonly ready: boolean
}

const PERSONAL_ONLY: WorkspaceScope = Object.freeze({ workspaceId: null, ready: true })

export function useWorkspaceScope(): WorkspaceScope {
  // Subscribed unconditionally — hooks may not be called conditionally, and
  // the store is a no-op shell when organizations are off.
  const state = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  )

  if (!hasOrganizations()) return PERSONAL_ONLY

  return {
    workspaceId: state.activeWorkspaceId,
    // `unavailable` counts as settled: the lookup failed, the remembered
    // selection is deliberately kept, and holding every list behind a failed
    // request would turn one bad response into an unusable app.
    ready: state.status === "ready" || state.status === "unavailable",
  }
}
