import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listNodePresets,
  createNodePreset,
  deleteNodePreset,
  importNodePresets,
} from "@/lib/api"

export function useNodePresets(nodeType: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.nodePresets.list(nodeType),
    queryFn: () => listNodePresets(nodeType),
    enabled: !!userId && !!nodeType,
    staleTime: 60_000,
  })
}

export function useNodePresetMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.nodePresets.all })

  const create = useMutation({
    mutationFn: (input: {
      nodeType: string
      name: string
      description?: string
      data: Record<string, unknown>
    }) => createNodePreset(input),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteNodePreset(id),
    onSuccess: invalidate,
  })
  const importMany = useMutation({
    mutationFn: (
      presets: { nodeType: string; name: string; description?: string; data: Record<string, unknown> }[],
    ) => importNodePresets(presets),
    onSuccess: invalidate,
  })

  return { create, remove, importMany }
}
