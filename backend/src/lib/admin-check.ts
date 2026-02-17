import { supabase } from "./supabase.js"

const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>()
const CACHE_TTL_MS = 300_000 // 5 minutes — role changes are rare

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

  const isAdmin = data?.role === "admin" || data?.role === "super_admin"
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS })
  return isAdmin
}

/**
 * Pre-warm admin cache from an already-fetched profile (e.g. creditGuard).
 * Avoids a separate DB round-trip when the role is already known.
 */
export function warmAdminCache(userId: string, role: string | null | undefined): void {
  const isAdmin = role === "admin" || role === "super_admin"
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS })
}
