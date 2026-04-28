import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  listDeveloperApps,
  getDeveloperApp,
  createDeveloperApp,
  updateDeveloperApp,
  deleteDeveloperApp,
  rotateDeveloperAppSecret,
  type DeveloperApp,
  type CreateDeveloperAppInput,
  type UpdateDeveloperAppInput,
  type CreateDeveloperAppResult,
} from "@/lib/api"

export function useDeveloperApps() {
  return useQuery({
    queryKey: queryKeys.developerApps.list(),
    queryFn: async () => (await listDeveloperApps()).data,
    staleTime: 30_000,
  })
}

export function useDeveloperApp(id: string | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.developerApps.detail(id) : queryKeys.developerApps.list(),
    queryFn: async () => {
      if (!id) throw new Error("id required")
      return (await getDeveloperApp(id)).data
    },
    enabled: !!id,
  })
}

export function useCreateDeveloperAppMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateDeveloperAppInput): Promise<CreateDeveloperAppResult> =>
      (await createDeveloperApp(input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.developerApps.all })
    },
  })
}

export function useUpdateDeveloperAppMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id: string
      input: UpdateDeveloperAppInput
    }): Promise<DeveloperApp> => (await updateDeveloperApp(params.id, params.input)).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.developerApps.list() })
      qc.invalidateQueries({ queryKey: queryKeys.developerApps.detail(vars.id) })
    },
  })
}

export function useDeleteDeveloperAppMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => deleteDeveloperApp(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.developerApps.all })
    },
  })
}

export function useRotateSecretMutation() {
  return useMutation({
    mutationFn: async (id: string): Promise<{ clientSecret: string }> =>
      rotateDeveloperAppSecret(id),
  })
}
