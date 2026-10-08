import { useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { fetchClusterMembers, fetchUsersLinkage } from "./api"
import type { ClusterMembers, LinkageResponse } from "./types"

/**
 * Under the ["admin", "users"] prefix on purpose: a block or a take-back
 * (useInvalidateAccess in use-admin-access.ts) invalidates that prefix, and
 * the marks must refresh with the rows they annotate.
 */
export const usersLinkageKey = (ids: readonly string[]) =>
  ["admin", "users", "linkage", [...ids].sort().join(",")] as const

export const clusterMembersKey = (key: string) => ["admin", "users", "linkage", "cluster", key] as const

/** The linked-account marks for one page of the users table. */
export function useUsersLinkage(ids: readonly string[], enabled: boolean) {
  return useQuery<LinkageResponse>({
    queryKey: usersLinkageKey(ids),
    queryFn: ({ signal }) => fetchUsersLinkage(ids, signal),
    enabled: enabled && hasAdmin() && ids.length > 0,
    staleTime: 30_000,
  })
}

/** One cluster's members, read when its card opens. */
export function useClusterMembers(key: string | null) {
  return useQuery<ClusterMembers>({
    queryKey: clusterMembersKey(key ?? ""),
    queryFn: ({ signal }) => fetchClusterMembers(key ?? "", signal),
    enabled: hasAdmin() && key !== null,
    staleTime: 15_000,
  })
}
