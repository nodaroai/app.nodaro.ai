import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listNodePresets,
  createNodePreset,
  updateNodePreset,
  deleteNodePreset,
  importNodePresets,
  reorderNodePresets,
  listNodePresetGroups,
  createNodePresetGroup,
  updateNodePresetGroup,
  deleteNodePresetGroup,
  type NodePreset,
  type NodePresetGroup,
} from "@/lib/api"

export function useNodePresets(nodeType: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.nodePresets.list(nodeType),
    queryFn: () => listNodePresets(nodeType),
    enabled: !!userId && !!nodeType,
    staleTime: 60_000,
  })
}

export function useNodePresetGroups(nodeType: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.nodePresetGroups.list(nodeType),
    queryFn: () => listNodePresetGroups(nodeType),
    enabled: !!userId && !!nodeType,
    staleTime: 60_000,
  })
}

export function useNodePresetMutations() {
  const qc = useQueryClient()
  // Most actions move presets between groups / reorder both, so invalidate both caches.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.nodePresets.all })
    qc.invalidateQueries({ queryKey: queryKeys.nodePresetGroups.all })
  }

  const create = useMutation({
    mutationFn: (input: {
      nodeType: string
      name: string
      description?: string
      data: Record<string, unknown>
      groupId?: string | null
      tags?: string[]
      sortOrder?: number
    }) => createNodePreset(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: {
        name?: string
        description?: string
        data?: Record<string, unknown>
        groupId?: string | null
        tags?: string[]
        sortOrder?: number
      }
    }) => updateNodePreset(id, patch),
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
  const reorder = useMutation({
    mutationFn: (input: {
      groups?: { id: string; sortOrder: number }[]
      presets?: { id: string; groupId?: string | null; sortOrder: number }[]
    }) => reorderNodePresets(input),
    onSuccess: invalidate,
  })

  // Group (folder/section) mutations.
  const createGroup = useMutation({
    mutationFn: (input: { nodeType: string; name: string; kind: "folder" | "section"; sortOrder?: number }) =>
      createNodePresetGroup(input),
    onSuccess: invalidate,
  })
  const updateGroup = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; sortOrder?: number } }) =>
      updateNodePresetGroup(id, patch),
    onSuccess: invalidate,
  })
  const removeGroup = useMutation({
    mutationFn: (id: string) => deleteNodePresetGroup(id),
    onSuccess: invalidate,
  })

  return { create, update, remove, importMany, reorder, createGroup, updateGroup, removeGroup }
}

export type { NodePreset, NodePresetGroup }
