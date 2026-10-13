import { useQuery } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"
import type { MapSinglesPage, UsersMapResponse } from "./types"

/**
 * Under the ["admin", "users"] prefix on purpose, like the linkage marks: a
 * block or a take-back invalidates that prefix, and the map must redraw the
 * screen it changed.
 */
export const usersMapKey = () => ["admin", "users", "linkage", "map"] as const

/** Who is generating moves by the minute; the map asks twice a minute while it is open and in view. */
export const USERS_MAP_POLLING = { refetchInterval: 30_000, refetchIntervalInBackground: false } as const

async function fetchUsersMap(signal?: AbortSignal): Promise<UsersMapResponse> {
  const res = await fetch("/v1/admin/users/linkage/map", { headers: await getAuthHeaders(), signal })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? "Failed to load the users map")
  }
  return (await res.json()) as UsersMapResponse
}

export function useUsersMap(enabled: boolean) {
  return useQuery<UsersMapResponse>({
    queryKey: usersMapKey(),
    queryFn: ({ signal }) => fetchUsersMap(signal),
    enabled: enabled && hasAdmin(),
    staleTime: 15_000,
    ...USERS_MAP_POLLING,
  })
}

async function fetchUsersMapSingles(page: number, signal?: AbortSignal): Promise<MapSinglesPage> {
  const res = await fetch(`/v1/admin/users/linkage/map/singles?page=${page}`, { headers: await getAuthHeaders(), signal })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(body?.error?.message ?? "Failed to load the users")
  }
  return (await res.json()) as MapSinglesPage
}

/** The rest of the regular users, 100 a page; off (`page === null`) the map keeps its newest 45. */
export function useUsersMapSingles(page: number | null) {
  return useQuery<MapSinglesPage>({
    queryKey: [...usersMapKey(), "singles", page ?? -1],
    queryFn: ({ signal }) => fetchUsersMapSingles(page ?? 0, signal),
    enabled: page !== null && hasAdmin(),
    staleTime: 15_000,
    ...USERS_MAP_POLLING,
  })
}
