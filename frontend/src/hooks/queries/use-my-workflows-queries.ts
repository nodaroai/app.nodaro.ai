import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { STUDIO_APP_SLUG, isMissingColumnError, readShowClientAppsFlag } from "./use-client-apps-queries"

export interface MyWorkflow {
  readonly id: string
  readonly projectId: string
  readonly projectName: string
  readonly projectIsDefault: boolean
  readonly folderId: string | null
  readonly name: string
  readonly thumbnailUrl: string | null
  /**
   * Distinct node types in the flow, for the cover placeholder. `null` on an
   * environment whose database has not applied migration 337 yet — the
   * placeholder treats that exactly like an empty flow.
   */
  readonly nodeTypes: readonly string[] | null
  readonly createdAt: string
  readonly updatedAt: string
  /** Set only by the admin "all users" Studio view; the owner's email. */
  readonly ownerEmail?: string | null
}

interface DbWorkflowRow {
  readonly id: string
  readonly project_id: string
  readonly folder_id: string | null
  readonly name: string
  readonly thumbnail_url: string | null
  readonly cover_node_types?: string[] | null
  readonly created_at: string
  readonly updated_at: string
  // PostgREST embedded selection: { ...projects(id, name, is_default?) }.
  // Returned as an object when the FK has cardinality one — which is our
  // case since workflows.project_id is NOT NULL with a single-row FK.
  // `is_default` is optional because pre-migration-116 environments don't
  // expose the column at all (the select falls back to projects(id, name)).
  readonly projects: {
    readonly id: string
    readonly name: string
    readonly is_default?: boolean
  } | null
}

function toMyWorkflow(row: DbWorkflowRow): MyWorkflow {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.projects?.name ?? "Unknown",
    projectIsDefault: row.projects?.is_default === true,
    folderId: row.folder_id,
    name: row.name,
    thumbnailUrl: row.thumbnail_url,
    nodeTypes: row.cover_node_types ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const WORKFLOW_COLS =
  "id, project_id, folder_id, name, thumbnail_url, cover_node_types, created_at, updated_at"

/**
 * The same list without `cover_node_types` (migration 337). Selecting a column
 * PostgREST does not know about fails the whole request, so an environment that
 * has not applied the migration yet must still be able to list workflows —
 * covers simply fall back to the empty-flow default there.
 */
const WORKFLOW_COLS_LEGACY =
  "id, project_id, folder_id, name, thumbnail_url, created_at, updated_at"

/**
 * Column sets from richest to poorest.
 *
 * PostgREST fails the WHOLE request when a select names a column it does not
 * know, so a self-hosted database that is behind on migrations would otherwise
 * see an empty dashboard rather than a slightly plainer one. Each step down
 * drops exactly one migration's column: 337's `cover_node_types` (covers fall
 * back to the empty-flow default) and 116's `projects.is_default` (the default
 * project loses its badge).
 */
const SELECT_LADDER = [
  `${WORKFLOW_COLS}, projects(id, name, is_default)`,
  `${WORKFLOW_COLS}, projects(id, name)`,
  `${WORKFLOW_COLS_LEGACY}, projects(id, name, is_default)`,
  `${WORKFLOW_COLS_LEGACY}, projects(id, name)`,
]

type WorkflowQuery = (cols: string) => PromiseLike<{ data: unknown; error: unknown }>

async function selectFirstThatWorks(baseQuery: WorkflowQuery): Promise<DbWorkflowRow[]> {
  let lastError: unknown = null
  for (const cols of SELECT_LADDER) {
    const { data, error } = await baseQuery(cols)
    if (!error) return (data ?? []) as DbWorkflowRow[]
    // Step down ONLY for "that column does not exist". Retrying on any error
    // would turn an expired session or a network blip into three more failing
    // round-trips and then a plainer dashboard, with nothing to say why.
    if (!isMissingColumnError(error)) throw error
    lastError = error
  }
  throw lastError
}

/**
 * Flat, owner-scoped list of every workflow the caller owns, joined with
 * minimal project info (name + isDefault) for badge rendering. Powers the
 * "My Workflows" dashboard tab. Excludes sub-workflows (parent_workflow_id
 * IS NOT NULL) so the list shows top-level flows only.
 *
 * VISIBILITY: NATIVE ONLY — `app_slug IS NULL`. This is deliberate, not an
 * oversight: every client app that is registered with `workflows_listed = true`
 * (studio today) already gets its own dedicated dashboard tab — see
 * `useMyStudioWorkflows` below. If this query also admitted listed apps
 * (`app_slug IS NULL OR app is listed`), studio's workflows would render here
 * AND in "Studio Workflows" — the exact double-listing bug this filter fixes.
 *
 * `client_apps.workflows_listed` is real and still load-bearing (it gates the
 * admin screen, and in Phase 2 will gate `GET /v1/workflows`'s default set) —
 * it is simply a different question from "does My Workflows show it", so this
 * query never reads the registry at all. DO NOT "simplify" this back into an
 * OR-with-listed-apps filter (e.g. reintroducing `workflowVisibilityFilter` /
 * `fetchListedAppSlugs` here) — that reintroduces the duplicate-tab bug.
 *
 * Tries the full select (with `projects.is_default`) first. Pre-migration
 * environments fail at the PostgREST level with "column does not exist";
 * we retry without `is_default` so the tab keeps rendering — the ⭐ badge
 * is just lost until the migration applies.
 */
export function useMyWorkflows() {
  return useQuery({
    queryKey: queryKeys.workflows.listMine(),
    queryFn: async (): Promise<MyWorkflow[]> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      // Native-only is the DEFAULT and stays that way (see the doc comment above:
      // listed apps have their own tabs). The ONE exception is the admin "show
      // client-app content" override: when an admin opts in, we DROP the native
      // filter so the otherwise-hidden client-app rows (voice-changer-pro
      // conversions) become visible. This is NOT the `workflowVisibilityFilter`
      // OR-with-listed path the comment warns against — it never runs by default,
      // so it cannot reintroduce the studio double-listing for normal users.
      const showClientApps = readShowClientAppsFlag()

      const baseQuery = (cols: string) => {
        let q = supabase
          .from("workflows")
          .select(cols)
          .eq("user_id", user.id)
          .is("parent_workflow_id", null)
        if (!showClientApps) q = q.is("app_slug", null)
        return q.order("updated_at", { ascending: false }).limit(200)
      }

      const rows = await selectFirstThatWorks(baseQuery)
      return rows.map(toMyWorkflow)
    },
    staleTime: 30_000,
  })
}

/**
 * Owner-scoped list of the caller's Studio-origin workflows — the rows whose
 * `app_slug` is 'studio'. Powers the default view of the "Studio Workflows"
 * dashboard tab: same shape and project join as useMyWorkflows, but scoped by
 * `app_slug` equality to one app instead of `app_slug IS NULL`.
 */
export function useMyStudioWorkflows() {
  return useQuery({
    queryKey: queryKeys.workflows.listStudioMine(),
    queryFn: async (): Promise<MyWorkflow[]> => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const baseQuery = (cols: string) =>
        supabase
          .from("workflows")
          .select(cols)
          .eq("user_id", user.id)
          .is("parent_workflow_id", null)
          .eq("app_slug", STUDIO_APP_SLUG)
          .order("updated_at", { ascending: false })
          .limit(200)

      return (await selectFirstThatWorks(baseQuery)).map(toMyWorkflow)
    },
    staleTime: 30_000,
  })
}

export interface AllStudioWorkflowsResult {
  readonly data: MyWorkflow[]
  readonly currentUserId: string
}

/**
 * Admin-only: every user's Studio-origin workflows, via the backend
 * GET /v1/workflows?viewAll=true&studio=true (mirrors useAllProjects). Each row
 * carries ownerEmail; projectName is not joined (cards show the owner instead).
 * Pass enabled = isAdmin && viewAll.
 */
export function useAllStudioWorkflows(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.workflows.listStudioAll(),
    queryFn: async (): Promise<AllStudioWorkflowsResult> => {
      // Thread the one admin reveal flag so "the one toggle governs everything".
      // NOTE: this call is scoped to `studio` (a LISTED app), so the backend's
      // default client-app exclusion never applies and `includeClientApps` is a
      // no-op here — studio workflows show regardless. It is wired for
      // consistency and to future-proof a bare (un-scoped) all-workflows fetcher.
      const includeClientApps = readShowClientAppsFlag()
      const res = await fetch(
        `/v1/workflows?viewAll=true&studio=true${includeClientApps ? "&includeClientApps=true" : ""}`,
        { headers: await getAuthHeaders() },
      )
      if (!res.ok) throw new Error("Failed to fetch all Studio workflows")
      const json = await res.json()
      const rows = (json.data as Record<string, unknown>[]) ?? []
      return {
        data: rows.map((row) => ({
          id: row.id as string,
          projectId: row.projectId as string,
          projectName: "",
          projectIsDefault: false,
          folderId: (row.folderId as string | null) ?? null,
          name: row.name as string,
          thumbnailUrl: (row.thumbnailUrl as string | null) ?? null,
          // The REST list does not carry node types, so the admin Studio grid
          // falls back to the empty-flow cover — honest for a view of other
          // people's work, which is not a place to pick covers anyway.
          nodeTypes: null,
          createdAt: row.createdAt as string,
          updatedAt: row.updatedAt as string,
          ownerEmail: (row.ownerEmail as string | null) ?? null,
        })),
        currentUserId: json.currentUserId as string,
      }
    },
    enabled,
    staleTime: 30_000,
  })
}
