/**
 * The account's standing authorization of the content rights declaration for
 * imports through its API keys and AI agents (`/v1/content-rights/authorization`,
 * `nodaroClient.contentRights`): read for the settings card, given and revoked
 * from it. A key or an agent cannot give one — the server refuses anything but
 * the person's own session — so only the settings page ever writes.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { nodaroClient } from "@/lib/nodaro-client"

export function useStandingAuthorization() {
  return useQuery({
    queryKey: queryKeys.contentRights.authorization(),
    queryFn: () => nodaroClient.contentRights.authorization(),
    staleTime: 30_000,
  })
}

export function useAuthorizeImportsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (declarationVersion: number) => nodaroClient.contentRights.authorize({ declarationVersion }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contentRights.all })
    },
  })
}

export function useRevokeImportsAuthorizationMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => nodaroClient.contentRights.revokeAuthorization(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.contentRights.all })
    },
  })
}
