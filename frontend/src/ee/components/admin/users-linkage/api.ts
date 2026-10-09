import { getAuthHeaders } from "@/lib/api"
import type { ClusterMembers, LinkageResponse } from "./types"

/** The server's own sentence when it has one, so an operator sees the refusal and not a generic failure. */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return new Error(body?.error?.message ?? fallback)
}

/** The marks for one page of users. `signal` is react-query's: a superseded refetch is cancelled, not served. */
export async function fetchUsersLinkage(ids: readonly string[], signal?: AbortSignal): Promise<LinkageResponse> {
  const res = await fetch(`/v1/admin/users/linkage?ids=${encodeURIComponent(ids.join(","))}`, {
    headers: await getAuthHeaders(),
    signal,
  })
  if (!res.ok) throw await errorFrom(res, "Failed to load linked accounts")
  return (await res.json()) as LinkageResponse
}

export async function fetchClusterMembers(key: string, signal?: AbortSignal): Promise<ClusterMembers> {
  const res = await fetch(`/v1/admin/users/linkage/cluster?key=${encodeURIComponent(key)}`, {
    headers: await getAuthHeaders(),
    signal,
  })
  if (!res.ok) throw await errorFrom(res, "Failed to load the cluster")
  return ((await res.json()) as { data: ClusterMembers }).data
}
