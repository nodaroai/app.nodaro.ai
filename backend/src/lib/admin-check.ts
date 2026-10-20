import { supabase } from "./supabase.js"

const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>()
const CACHE_TTL_MS = 300_000 // 5 minutes — role changes are rare

/** Single source of truth for which `profiles.role` values count as admin. */
export const ADMIN_ROLES: readonly string[] = ["admin", "super_admin"]

export function roleIsAdmin(role: string | null | undefined): boolean {
  return typeof role === "string" && ADMIN_ROLES.includes(role)
}

export async function checkIsAdmin(userId: string): Promise<boolean> {
  const cached = adminCache.get(userId)
  if (cached && Date.now() < cached.expiresAt) return cached.isAdmin

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return false
    throw new Error(`Admin check failed: ${error.message}`)
  }

  const isAdmin = roleIsAdmin(data?.role)
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS })
  return isAdmin
}

/**
 * Pre-warm admin cache from an already-fetched profile (e.g. creditGuard).
 * Avoids a separate DB round-trip when the role is already known.
 */
export function warmAdminCache(userId: string, role: string | null | undefined): void {
  adminCache.set(userId, { isAdmin: roleIsAdmin(role), expiresAt: Date.now() + CACHE_TTL_MS })
}

/**
 * Drop a user's cached admin verdict so a role change takes effect immediately.
 * Must be called wherever `profiles.role` is changed — otherwise a demoted admin
 * keeps admin access for up to CACHE_TTL_MS (privilege-revocation lag).
 */
export function invalidateAdminCache(userId: string): void {
  adminCache.delete(userId)
}
