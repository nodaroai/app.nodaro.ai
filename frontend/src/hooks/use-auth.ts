import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { resolveEffectiveTier } from "@nodaro/shared"
import { useNavigate } from "react-router-dom"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase"
import { hasCredits } from "@/lib/edition"
import { hydrateWorkspaces, resetWorkspaceState } from "@/lib/workspace-context"

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

/**
 * Load role + tier for `user` into the module cache (resets to defaults when
 * there's no user). Single source of truth for the profile→cache mapping —
 * shared by the initial load, refreshAuth, AND the onAuthStateChange handler.
 *
 * The handler call is the important one: an in-SPA sign-in (a SIGNED_IN event
 * WITHOUT a full page reload — e.g. email/password sign-in or an account
 * switch) previously updated `cachedUser` but never reloaded role/tier, so an
 * admin signing in kept the default "user" role (and lost /admin access) and a
 * paid user kept "free" tier (their list nodes ran at free-tier parallelism)
 * until a hard refresh. Reloading on every session change keeps role/tier in
 * lockstep with the live session.
 */
async function loadRoleAndTier(user: User | null): Promise<void> {
  if (!user) {
    cachedRole = "user"
    cachedTier = "free"
    // A signed-out browser must not keep pointing at someone's workspace:
    // the next person to sign in here would inherit the selection, and the
    // switcher would offer them a school they have never been in.
    resetWorkspaceState()
    return
  }
  // Which organizations and workspaces this session belongs to, loaded
  // alongside role and tier and for the same reason: every request the
  // client builds from here carries the selected workspace, so a page that
  // renders before this resolves would send none. Anchored to the session
  // rather than to a page so a deep link into the editor is covered too.
  // No-ops on a build without organizations, and never throws.
  void hydrateWorkspaces()
  const supabase = createClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, tier, subscription_tier, lifetime_topup_credits")
    .eq("id", user.id)
    .single()
  cachedRole = (profile?.role as UserRole) ?? "user"
  cachedTier = profile
    ? resolveEffectiveTier({
        tier: (profile.tier as string | null) ?? null,
        subscription_tier: (profile.subscription_tier as string | null) ?? null,
        lifetime_topup_credits: (profile.lifetime_topup_credits as number) ?? 0,
      })
    : "free"
  maybeClaimSignupGrant(user.id)
}

/**
 * The free signup grant is claimed from the SESSION, not from /signup: a
 * Google OAuth signup never renders that page, so this — the path every
 * entry point shares — is where the claim decision anchors. It runs on every
 * session change; the ee module holds its own once-per-page-load latch.
 *
 * It rides its OWN profile read, deliberately decoupled from the role/tier
 * select above: migrations reach the shared database only on a push to main,
 * so a dev deploy runs ahead of the free_grant_state column for the whole
 * staging soak, and a widened shared select would 400 there — collapsing
 * every staging user to user/free. Here the pre-migration read just returns
 * nothing and the claim stays dormant until the column lands.
 *
 * Fire-and-forget end to end, for reasons that are all load bearing: a
 * static `@/ee/` import from core fails the check-ee-imports guard (and
 * would put the fingerprint agent in the community bundle), and awaiting any
 * of this would sit a second profile read plus a canvas/WebGL probe in front
 * of first paint.
 */
function maybeClaimSignupGrant(userId: string): void {
  if (!hasCredits()) return
  const supabase = createClient()
  void Promise.resolve(
    supabase.from("profiles").select("free_grant_state").eq("id", userId).single(),
  )
    .then(({ data }) => {
      if (data?.free_grant_state !== "unclaimed") return
      return import("@/ee/lib/ensure-signup-grant").then((m) => m.ensureSignupGrant())
    })
    .catch(() => {})
}

function initAuth() {
  if (initialized) return
  initialized = true

  const supabase = createClient()

  async function loadUser() {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    cachedUser = currentUser
    await loadRoleAndTier(currentUser)
    cachedRoleLoaded = true
    cachedLoading = false
    notifyListeners()
  }

  loadUser()

  supabase.auth.onAuthStateChange((_event, session) => {
    const sessionUser = session?.user ?? null
    cachedUser = sessionUser
    // Re-derive role/tier for the (possibly new) session — NOT just on sign-out.
    // See loadRoleAndTier's docstring for why the sign-IN case matters.
    void loadRoleAndTier(sessionUser).then(() => {
      cachedRoleLoaded = true
      cachedLoading = false
      notifyListeners()
    })
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
  await loadRoleAndTier(currentUser)
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

  /** Email/password sign-in (self-host; GoTrue handles it natively). The
   *  resulting SIGNED_IN event flows through onAuthStateChange, which reloads
   *  role/tier — see loadRoleAndTier's docstring for why that matters. */
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      throw new Error(error.message)
    }
  }, [])

  /** Email/password sign-up. Returns whether a live session was created:
   *  true → signed in immediately (autoconfirm installs); false → the
   *  instance requires email confirmation first. */
  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<{ sessionCreated: boolean }> => {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        throw new Error(error.message)
      }
      return { sessionCreated: Boolean(data.session) }
    },
    [],
  )

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    navigate("/login")
  }, [navigate])

  const isAdmin = role === "admin" || role === "super_admin"

  return { user, role, isAdmin, loading, roleLoaded, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }
}
