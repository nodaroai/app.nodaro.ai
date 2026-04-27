import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { useNavigate } from "react-router-dom"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase"

export type UserRole = "user" | "admin" | "super_admin"

// Module-level auth cache — survives component unmount/remount
let cachedUser: User | null = null
let cachedRole: UserRole = "user"
let cachedTier = "free"
let cachedLoading = true
let cachedRoleLoaded = false
let initialized = false
let listeners = new Set<() => void>()

function notifyListeners() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function initAuth() {
  if (initialized) return
  initialized = true

  const supabase = createClient()

  async function loadUser() {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    cachedUser = currentUser

    if (currentUser) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, tier")
        .eq("id", currentUser.id)
        .single()
      if (profile?.role) {
        cachedRole = profile.role as UserRole
      }
      if (profile?.tier) {
        cachedTier = profile.tier as string
      }
    }

    cachedRoleLoaded = true
    cachedLoading = false
    notifyListeners()
  }

  loadUser()

  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUser = session?.user ?? null
    if (!session?.user) {
      cachedRole = "user"
      cachedTier = "free"
      cachedRoleLoaded = true
      cachedLoading = false
    }
    notifyListeners()
  })
}

// Snapshot getters for useSyncExternalStore
function getSnapshot() {
  return { user: cachedUser, role: cachedRole, loading: cachedLoading, roleLoaded: cachedRoleLoaded }
}

// Track snapshot reference for useSyncExternalStore
let lastSnapshot = getSnapshot()
function getStableSnapshot() {
  const next = getSnapshot()
  if (
    next.user !== lastSnapshot.user ||
    next.role !== lastSnapshot.role ||
    next.loading !== lastSnapshot.loading ||
    next.roleLoaded !== lastSnapshot.roleLoaded
  ) {
    lastSnapshot = next
  }
  return lastSnapshot
}

/** Re-check session from Supabase (e.g. after popup login completes) */
export async function refreshAuth(): Promise<void> {
  const supabase = createClient()
  const { data: { user: currentUser } } = await supabase.auth.getUser()
  cachedUser = currentUser

  if (currentUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, tier")
      .eq("id", currentUser.id)
      .single()
    if (profile?.role) {
      cachedRole = profile.role as UserRole
    }
    if (profile?.tier) {
      cachedTier = profile.tier as string
    }
  }

  cachedRoleLoaded = true
  cachedLoading = false
  notifyListeners()
}

/** Set session from tokens received via postMessage (e.g. from popup login).
 *  Necessary for cross-origin iframes where localStorage is partitioned. */
export async function setAuthFromTokens(accessToken: string, refreshToken: string): Promise<void> {
  const supabase = createClient()
  await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  // setSession triggers onAuthStateChange which updates cachedUser,
  // but also refresh explicitly to load role
  await refreshAuth()
}

/** Get the cached user tier (synchronous, no async). Falls back to "free". */
export function getCachedTier(): string {
  return cachedTier
}

/** Get the cached user id (synchronous). Returns undefined if not authenticated. */
export function getCachedUserId(): string | undefined {
  return cachedUser?.id
}

export function useAuth() {
  const navigate = useNavigate()

  // Initialize once on first use
  useEffect(() => { initAuth() }, [])

  const snapshot = useSyncExternalStore(subscribe, getStableSnapshot)

  // Also keep local state in sync for components that mount before initAuth completes
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    return subscribe(() => forceUpdate((n) => n + 1))
  }, [])

  const { user, role, loading, roleLoaded } = snapshot

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      throw new Error(error.message)
    }
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    navigate("/login")
  }, [navigate])

  const isAdmin = role === "admin" || role === "super_admin"

  return { user, role, isAdmin, loading, roleLoaded, signInWithGoogle, signOut }
}
