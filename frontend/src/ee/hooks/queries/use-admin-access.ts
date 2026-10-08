import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getAuthHeaders } from "@/lib/api"
import { hasAdmin } from "@/lib/edition"

/**
 * Admin access controls: blocked accounts, blocked networks, taking free
 * credits back. A separate file from use-admin-queries.ts (already well past
 * the size cap); the server routes are ee/routes/admin-access.ts and the
 * revoke/restore pair in ee/routes/admin-free-grants.ts.
 */

export interface AdminBlockedUser {
  readonly userId: string
  readonly email: string | null
  readonly reason: string | null
  readonly blockedBy: string | null
  readonly blockedAt: string
}

export interface AdminBlockedNetwork {
  readonly id: string
  /** A typed range — or null for a signup network, which is shown as a token only. */
  readonly range: string | null
  readonly token: string | null
  readonly label: string | null
  readonly fromUser: string | null
  readonly blockedBy: string | null
  readonly blockedAt: string
  readonly expiresAt: string
  /** Only a super admin could place it (a busy or paying network, a range), so only a super admin lifts it. */
  readonly superAdminOnly: boolean
}

export interface AdminBlocks {
  /** False until the database has the block tables (staging runs ahead of production). */
  readonly ready: boolean
  readonly status: { readonly ready: boolean; readonly users: number; readonly networks: number; readonly loadedAt: string | null }
  readonly users: readonly AdminBlockedUser[]
  readonly networks: readonly AdminBlockedNetwork[]
  /** The lists hold the newest 500 each; true when there are more. */
  readonly usersTruncated: boolean
  readonly networksTruncated: boolean
}

export interface AdminUserNetwork {
  readonly token: string | null
  /** Only a real client address recorded at signup can be blocked. */
  readonly blockable: boolean
  readonly signupAt: string
  readonly otherAccounts: number
  readonly payingAccounts: number
  readonly needsSuperAdmin: boolean
  readonly blocked: boolean
}

export interface AdminUserAccess {
  readonly ready: boolean
  readonly blocked: boolean
  readonly reason: string | null
  readonly blockedAt: string | null
  /** Sign-in is refused (GoTrue ban). null when it could not be read. */
  readonly signInBlocked: boolean | null
  readonly signInBanIsOurs: boolean | null
  readonly network: AdminUserNetwork | null
}

export interface AdminWhoami {
  readonly address: string | null
  readonly source: "edge-header" | "hop" | "unknown"
  readonly network: string | null
  readonly networkToken: string | null
}

const BLOCKS_KEY = ["admin", "access", "blocks"] as const
const userAccessKey = (userId: string) => ["admin", "access", "user", userId] as const

/**
 * A refusal with its status kept: a caller running several requests in a row
 * (the Users page's cluster block) tells a 403 it should skip from a 429 it
 * should wait out from a failure it should stop on.
 */
export class AccessError extends Error {
  readonly status: number
  /** From the Retry-After header, in seconds, when the server sent one. */
  readonly retryAfterSeconds: number | null

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message)
    this.name = "AccessError"
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The server's own sentence when it has one: every refusal here explains itself. */
async function accessError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  // Optional on purpose: a Response always has headers, but the panels' tests hand in bare
  // `{ ok, status, json }` stand-ins, and the refusal must still read word for word.
  const retryAfter = Number(res.headers?.get?.("retry-after") ?? NaN)
  return new AccessError(
    body?.error?.message || fallback,
    res.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  )
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url, { headers: await getAuthHeaders() })
  if (!res.ok) throw await accessError(res, fallback)
  return ((await res.json()) as { data: T }).data
}

async function send<T>(method: "POST" | "DELETE", url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await accessError(res, fallback)
  return ((await res.json()) as { data: T }).data
}

export function useAdminBlocks() {
  return useQuery({
    queryKey: BLOCKS_KEY,
    queryFn: () => getJson<AdminBlocks>("/v1/admin/access/blocks", "Failed to load blocks"),
    enabled: hasAdmin(),
    staleTime: 15_000,
  })
}

export function useAdminUserAccess(userId: string) {
  return useQuery({
    queryKey: userAccessKey(userId),
    queryFn: () => getJson<AdminUserAccess>(`/v1/admin/users/${userId}/access`, "Failed to load access"),
    enabled: hasAdmin() && userId.length > 0,
  })
}

export function useAdminWhoami() {
  return useQuery({
    queryKey: ["admin", "access", "whoami"] as const,
    queryFn: () => getJson<AdminWhoami>("/v1/admin/access/whoami", "Failed to read your network"),
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

/** Everything a change can move: the lists, the user's panel, and the users table (badge, credits). */
function useInvalidateAccess() {
  const qc = useQueryClient()
  return (userId?: string) => {
    void qc.invalidateQueries({ queryKey: BLOCKS_KEY })
    if (userId) void qc.invalidateQueries({ queryKey: userAccessKey(userId) })
    void qc.invalidateQueries({ queryKey: ["admin", "users"] })
    void qc.invalidateQueries({ queryKey: ["admin", "free-grants"] })
  }
}

export interface BlockResult {
  readonly blocked: boolean
  readonly signInBlocked: boolean | null
  /** Set when the block row was written but the sign-in step failed — pressing again repairs it. */
  readonly warning: string | null
}

export function useBlockUser() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { userId: string; reason?: string }) =>
      send<BlockResult>("POST", `/v1/admin/users/${p.userId}/block`, { reason: p.reason }, "Failed to block the account"),
    onSuccess: (_d, p) => invalidate(p.userId),
  })
}

export function useUnblockUser() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { userId: string }) =>
      send<BlockResult>("POST", `/v1/admin/users/${p.userId}/unblock`, {}, "Failed to unblock the account"),
    onSuccess: (_d, p) => invalidate(p.userId),
  })
}

export type BlockDays = 1 | 7 | 30 | 90

export function useBlockNetwork() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { userId?: string; address?: string; label?: string; days: BlockDays }) =>
      send<{ id: string; range: string | null; token: string | null; expiresAt: string; superAdminOnly: boolean }>(
        "POST",
        "/v1/admin/access/networks",
        { userId: p.userId, address: p.address, label: p.label || undefined, days: p.days },
        "Failed to block the network",
      ),
    onSuccess: (_d, p) => invalidate(p.userId),
  })
}

export function useUnblockNetwork() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { id: string }) =>
      send<{ id: string }>("DELETE", `/v1/admin/access/networks/${p.id}`, undefined, "Failed to lift the network block"),
    onSuccess: () => invalidate(),
  })
}

export interface GrantChangeResult {
  readonly state: string | null
  /** Credits moved: removed by a take-back, returned by a restore. */
  readonly credits?: number
}

export function useRevokeFreeGrant() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { userId: string }) =>
      send<GrantChangeResult>("POST", `/v1/admin/free-grants/${p.userId}/revoke`, {}, "Failed to take back the free credits"),
    onSuccess: (_d, p) => invalidate(p.userId),
  })
}

export function useRestoreFreeGrant() {
  const invalidate = useInvalidateAccess()
  return useMutation({
    mutationFn: (p: { userId: string }) =>
      send<GrantChangeResult>("POST", `/v1/admin/free-grants/${p.userId}/activate`, {}, "Failed to restore the free credits"),
    onSuccess: (_d, p) => invalidate(p.userId),
  })
}
