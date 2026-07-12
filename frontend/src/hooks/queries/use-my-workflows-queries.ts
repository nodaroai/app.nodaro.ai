import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { STUDIO_APP_SLUG } from "./use-client-apps-queries"

export interface MyWorkflow {
  readonly id: string
  readonly projectId: string
  readonly projectName: string
  readonly projectIsDefault: boolean
  readonly folderId: string | null
  readonly name: string
  readonly thumbnailUrl: string | null
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const WORKFLOW_COLS =
  "id, project_id, folder_id, name, thumbnail_url, created_at, updated_at"

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

      const fullSelect = `${WORKFLOW_COLS}, projects(id, name, is_default)`
      const fallbackSelect = `${WORKFLOW_COLS}, projects(id, name)`

      const baseQuery = (cols: string) =>
        supabase
          .from("workflows")
          .select(cols)
          .eq("user_id", user.id)
          .is("parent_workflow_id", null)
          .is("app_slug", null)
          .order("updated_at", { ascending: false })
          .limit(200)

      const primary = await baseQuery(fullSelect)
      if (!primary.error) {
        return (primary.data as unknown as DbWorkflowRow[]).map(toMyWorkflow)
      }

      // PostgREST error code PGRST204 / 42703 → column doesn't exist.
      // The fallback omits `is_default`; if that also fails the problem
      // isn't migration-state and we surface it.
      const fallback = await baseQuery(fallbackSelect)
      if (fallback.error) throw fallback.error
      return (fallback.data as unknown as DbWorkflowRow[]).map(toMyWorkflow)
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

      const fullSelect = `${WORKFLOW_COLS}, projects(id, name, is_default)`
      const fallbackSelect = `${WORKFLOW_COLS}, projects(id, name)`

      const baseQuery = (cols: string) =>
        supabase
          .from("workflows")
          .select(cols)
          .eq("user_id", user.id)
          .is("parent_workflow_id", null)
          .eq("app_slug", STUDIO_APP_SLUG)
          .order("updated_at", { ascending: false })
          .limit(200)

      const primary = await baseQuery(fullSelect)
      if (!primary.error) {
        return (primary.data as unknown as DbWorkflowRow[]).map(toMyWorkflow)
      }
      const fallback = await baseQuery(fallbackSelect)
      if (fallback.error) throw fallback.error
      return (fallback.data as unknown as DbWorkflowRow[]).map(toMyWorkflow)
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
      const res = await fetch("/v1/workflows?viewAll=true&studio=true", {
        headers: await getAuthHeaders(),
      })
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
