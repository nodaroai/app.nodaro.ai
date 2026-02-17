import { useQuery } from "@tanstack/react-query"
import { getWorkflowCostSummary } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import type { CharacterDefinition } from "@/types/nodes"

export interface ImportableWorkflow {
  readonly id: string
  readonly name: string
  readonly characters: readonly CharacterDefinition[]
}

export function useWorkflowCostSummary(jobIds: readonly string[]) {
  return useQuery({
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
  return useQuery({
    queryKey: queryKeys.editor.importableWorkflows(
      projectId ?? "",
      currentWorkflowId ?? "",
    ),
    queryFn: async () => {
      const supabase = createClient()
      let query = supabase
        .from("workflows")
        .select("id, name, settings")
        .order("updated_at", { ascending: false })

      if (projectId) {
        query = query.eq("project_id", projectId)
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
    enabled: isOpen,
    staleTime: 30_000,
  })
}
