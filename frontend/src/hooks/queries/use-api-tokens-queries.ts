import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listApiTokens,
  createApiToken,
  updateApiToken,
  deleteApiToken,
  type ApiToken,
  type CreateApiTokenResult,
} from "@/lib/api"

export function useApiTokens() {
  return useQuery({
    queryKey: queryKeys.apiTokens.list(),
    queryFn: async () => {
      const res = await listApiTokens()
      return res.data
    },
    staleTime: 30_000,
  })
}

export function useCreateApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      name: string
      workflowIds?: string[]
      rateLimit?: number
    }): Promise<CreateApiTokenResult> => {
      const res = await createApiToken(params)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}

export function useUpdateApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...params
    }: {
      id: string
      name?: string
      workflowIds?: string[]
      rateLimit?: number
      isActive?: boolean
    }): Promise<ApiToken> => {
      const res = await updateApiToken(id, params)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}

export function useDeleteApiTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      return deleteApiToken(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiTokens.all })
    },
  })
}
