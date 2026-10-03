import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { listConnectedApps, revokeConnectedApp } from "@/lib/api"

export function useConnectedApps() {
  return useQuery({
    queryKey: queryKeys.connectedApps.list(),
    queryFn: async () => (await listConnectedApps()).apps,
    staleTime: 30_000,
  })
}

export function useRevokeConnectedAppMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (authorizationId: string) => revokeConnectedApp(authorizationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.connectedApps.all })
    },
  })
}
