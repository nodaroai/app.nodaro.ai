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
  listNodePresetFavorites,
  addNodePresetFavorite,
  removeNodePresetFavorite,
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

/** A node's favorited preset ids (factory + user), most-recent first. */
export function useNodePresetFavorites(nodeType: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.nodePresetFavorites.list(nodeType),
    queryFn: () => listNodePresetFavorites(nodeType as string),
    enabled: !!userId && !!nodeType,
    staleTime: 60_000,
  })
}

type FavCtx = { prev: string[] | undefined }

/**
 * Add/remove a preset favorite for one node type. Unlike the preset/group mutations below
 * (invalidate-only), these are OPTIMISTIC — a star toggle needs instant feedback — so they
 * flip the cached id-array immediately and roll back on error. Intentional divergence; do not
 * "simplify" back to invalidate-only.
 */
export function useNodePresetFavoriteMutations(nodeType: string | undefined) {
  const qc = useQueryClient()
  const key = queryKeys.nodePresetFavorites.list(nodeType)

  const add = useMutation<void, Error, string, FavCtx>({
    mutationFn: (presetId) => addNodePresetFavorite(nodeType as string, presetId),
    onMutate: async (presetId) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<string[]>(key)
      qc.setQueryData<string[]>(key, (cur) => (cur?.includes(presetId) ? cur : [presetId, ...(cur ?? [])]))
      return { prev }
    },
    onError: (_e, _presetId, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation<void, Error, string, FavCtx>({
    mutationFn: (presetId) => removeNodePresetFavorite(nodeType as string, presetId),
    onMutate: async (presetId) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<string[]>(key)
      qc.setQueryData<string[]>(key, (cur) => (cur ?? []).filter((id) => id !== presetId))
      return { prev }
    },
    onError: (_e, _presetId, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  return { add, remove }
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
