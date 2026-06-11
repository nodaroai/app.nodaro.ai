import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { SnippetMedia, SnippetTarget } from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import {
  listPromptSnippets,
  createPromptSnippet,
  updatePromptSnippet,
  deletePromptSnippet,
  type PromptSnippet,
} from "@/lib/api"
import { buildSnippetPool, type SnippetPoolItem } from "@/lib/snippet-pool"

export function usePromptSnippets(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.promptSnippets.list(),
    queryFn: () => listPromptSnippets(),
    enabled: !!userId,
    staleTime: 60_000,
  })
}

export function usePromptSnippetMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.promptSnippets.all })

  const create = useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      text: string
      target: SnippetTarget
      media: string[]
      category?: string
    }) => createPromptSnippet(input),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: {
      id: string
      patch: {
        name?: string
        description?: string | null
        text?: string
        target?: SnippetTarget
        media?: string[]
        category?: string | null
        sortOrder?: number
      }
    }) => updatePromptSnippet(id, patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deletePromptSnippet(id),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

/**
 * The merged factory + user snippet pool for ONE field (already filtered by
 * the node's modality and the field's target). This is the single object the
 * PromptEditor `snippets` prop, the TagTextarea `snippets` prop, and the
 * SnippetMenuButton all consume. Returns [] while logged out / loading /
 * media undefined — every consumer degrades gracefully on empty.
 */
export function useSnippetPool(
  media: SnippetMedia | undefined,
  target: SnippetTarget,
): SnippetPoolItem[] {
  const { user } = useAuth()
  const { data: userSnippets = [] } = usePromptSnippets(user?.id)
  return useMemo(
    () => (media ? buildSnippetPool({ media, target, userSnippets }) : []),
    [media, target, userSnippets],
  )
}

export type { PromptSnippet }
