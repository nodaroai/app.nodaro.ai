import { useQuery } from "@tanstack/react-query"
import { getWorkflowCostSummary } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspaceScope } from "@/hooks/use-workspace-scope"
import type { CharacterDefinition } from "@/types/nodes"

export interface ImportableWorkflow {
  readonly id: string
  readonly name: string
  readonly characters: readonly CharacterDefinition[]
}

export function useWorkflowCostSummary(jobIds: readonly string[]) {
  return useQuery({
    // scope-key-ok: keyed by the job ids themselves, and jobs carry no
    // workspace of their own until the billing work stamps them.
    queryKey: queryKeys.editor.costSummary(jobIds),
    queryFn: async () => {
      const { data } = await getWorkflowCostSummary(jobIds)
      return data
    },
    enabled: jobIds.length > 0 && hasCredits(),
    staleTime: 60_000,
  })
}

export function useImportableWorkflows(
  projectId: string | undefined,
  currentWorkflowId: string | null | undefined,
  isOpen: boolean,
) {
  // Only the no-project branch below scopes, but the KEY carries the
  // workspace either way: one key that sometimes depends on the scope and
  // sometimes does not is a key nobody can reason about.
  const { workspaceId, ready } = useWorkspaceScope()
  return useQuery({
    queryKey: [
      ...queryKeys.editor.importableWorkflows(projectId ?? "", currentWorkflowId ?? ""),
      workspaceId ?? "personal",
    ],
    queryFn: async () => {
      const supabase = createClient()
      let query = supabase
        .from("workflows")
        .select("id, name, settings")
        .order("updated_at", { ascending: false })

      if (projectId) {
        // A project already decides the scope — filtering by workspace on
        // top of it would be the same answer twice.
        query = query.eq("project_id", projectId)
      } else {
        query = workspaceId
          ? query.eq("workspace_id", workspaceId)
          : query.is("workspace_id", null)
      }

      const { data, error } = await query

      if (error) throw error

      return (data ?? [])
        .filter((w: { id: string }) => w.id !== currentWorkflowId)
        .map((w: { id: string; name: string; settings: unknown }) => {
          const settings = (w.settings ?? {}) as Record<string, unknown>
          const characters = (settings.characterDefinitions ?? []) as CharacterDefinition[]
          return { id: w.id, name: w.name, characters } as ImportableWorkflow
        })
        .filter((w) => w.characters.length > 0)
    },
    enabled: isOpen && ready,
    staleTime: 30_000,
  })
}
