import { useEffect, useState } from "react"
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { adminError } from "./use-admin-queries"

/**
 * The accounts the admin pickers offer, read from `GET /v1/admin/user-lookup`
 * (backend/src/ee/routes/admin-user-lookup.ts): a search over every account,
 * one address, a set of ids, the admins. Never the whole `profiles` table —
 * the browser's old read stopped at 1,000 unordered rows, so past 1,000
 * accounts some could not be found and an admin past the cap was not hidden.
 */

export interface AdminUserLite {
  readonly id: string
  readonly email: string
  readonly fullName: string | null
  readonly role: "user" | "admin" | "super_admin"
}

const NO_USERS: ReadonlyArray<AdminUserLite> = []
/** The route answers at most this many ids a call. */
const IDS_PER_CALL = 200
/** How long typing rests before a search is sent. */
export const USER_SEARCH_DEBOUNCE_MS = 250

async function lookup(params: Record<string, string>): Promise<ReadonlyArray<AdminUserLite>> {
  const res = await fetch(`/v1/admin/user-lookup?${new URLSearchParams(params)}`, { headers: await getAuthHeaders() })
  if (!res.ok) throw await adminError(res, "Failed to look up users")
  return ((await res.json()) as { data?: AdminUserLite[] }).data ?? []
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms: number = USER_SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * Accounts whose address or name contains `term` (already debounced by the
 * caller), ordered by address. No term, no request. The previous answer stays
 * on screen while the next one loads, so the list does not flash empty.
 */
export function useAdminUserSearch(term: string, options: { limit?: number; enabled?: boolean } = {}) {
  const search = term.trim()
  const limit = options.limit ?? 20
  return useQuery({
    queryKey: queryKeys.admin.userLookup("search", `${limit}:${search.toLowerCase()}`),
    queryFn: () => lookup({ search, limit: String(limit) }),
    enabled: hasAdmin() && search.length > 0 && (options.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
}

/** The account with this address (case aside), or null when there is none. */
export function useAdminUserByEmail(email: string | undefined) {
  const address = email?.trim().toLowerCase() ?? ""
  return useQuery({
    queryKey: queryKeys.admin.userLookup("email", address),
    queryFn: async () => (await lookup({ email: address }))[0] ?? null,
    enabled: hasAdmin() && address.length > 0,
    staleTime: 60_000,
  })
}

/** These accounts, for labels and roles: read in calls of 200 ids. */
export function useAdminUsersByIds(ids: ReadonlyArray<string>, options: { enabled?: boolean } = {}) {
  const sorted = [...new Set(ids)].sort()
  const chunks: string[][] = []
  for (let i = 0; i < sorted.length; i += IDS_PER_CALL) chunks.push(sorted.slice(i, i + IDS_PER_CALL))
  const enabled = hasAdmin() && (options.enabled ?? true)
  return useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: queryKeys.admin.userLookup("ids", chunk.join(",")),
      queryFn: () => lookup({ ids: chunk.join(",") }),
      enabled,
      staleTime: 60_000,
    })),
    combine: combineUsers,
  })
}

/** Module-level, so TanStack keeps the combined result while the chunks' answers do not change. */
function combineUsers(results: ReadonlyArray<{ data?: ReadonlyArray<AdminUserLite>; isSuccess: boolean; isError: boolean }>) {
  return {
    data: results.length === 0 ? NO_USERS : results.flatMap((r) => r.data ?? []),
    isSuccess: results.every((r) => r.isSuccess),
    isError: results.some((r) => r.isError),
  }
}

/** Every admin and super admin account (the "hide admins" filter's ids). */
export function useAdminAccounts(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.admin.userLookup("admins", ""),
    queryFn: () => lookup({ admins: "1" }),
    enabled: hasAdmin() && (options.enabled ?? true),
    staleTime: 60_000,
  })
}
