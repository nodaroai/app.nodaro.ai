import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase"
import { queryKeys } from "@/lib/query-keys"

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
