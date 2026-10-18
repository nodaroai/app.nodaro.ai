import { useState, useEffect, useRef } from "react"
import { hasCredits } from "@/lib/edition"
import { useLocation, useNavigate, Outlet } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppSidebar, MobileHeader } from "@/components/layout/app-sidebar"
import { FreeGrantBannerSlot } from "@/components/layout/free-grant-banner-slot"
import { ConsentGateSlot } from "@/components/layout/consent-gate-slot"
import { WelcomeOfferPopupSlot } from "@/components/layout/welcome-offer-popup-slot"
import { SiteHeaderSlot } from "@/components/layout/site-header-slot"
import { useSharedHeaderActive } from "@/lib/shared-header"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { useLoadUserSettings } from "@/hooks/use-load-user-settings"
import { useAuth } from "@/hooks/use-auth"
import { useEmbedSessionHandoff, isEmbedded } from "@/hooks/use-embed-session-handoff"
import { loadSurfaceAvailability, resetSurfaceAvailability } from "@/lib/surface-availability"
import { loadScene3DProAvailability } from "@/lib/scene3d-pro-availability"
import { watchEditPlanModes } from "@/lib/edit-plan-modes"
import { getAuthHeaders } from "@/lib/api"
import { whenActivated } from "@/lib/prerender"
import { isEditorPath, loginPathFor } from "./dashboard-paths"

export default function DashboardLayout() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // When embedded (e.g. studio.nodaro.ai's pricing iframe), a trusted parent
  // hands us the Supabase session via postMessage — hold the login redirect
  // while that's in flight instead of flashing /login.
  const { awaitingHandoff } = useEmbedSessionHandoff()

  // Load user prompt templates into workflow store on app init
  useLoadUserSettings()

  // Check if we're in the editor - sidebar starts collapsed but can be expanded
  const isEditor = isEditorPath(location.pathname)

  // When this app is rendered inside a cross-origin iframe (e.g. studio.nodaro.ai
  // embeds /billing or /pricing as a chromeless modal), drop the app chrome
  // (sidebar + mobile header) so only the page content shows. The session is
  // still adopted via useEmbedSessionHandoff above, so auth-gated pages work.
  const embedded = isEmbedded()

  // Redirect unauthenticated users to login (unless an embed session handoff
  // is still pending — see useEmbedSessionHandoff). A link opened signed out
  // comes back after sign-in; a session that ends mid-use does not (see
  // loginPathFor).
  const wasSignedIn = useRef(false)
  useEffect(() => {
    if (user) wasSignedIn.current = true
  }, [user])
  useEffect(() => {
    if (!authLoading && !user && !awaitingHandoff) {
      // Once the page is shown (lib/prerender.ts): a prerendered page must not move.
      return whenActivated(() =>
        navigate(loginPathFor(location.pathname + location.search, wasSignedIn.current), { replace: true }),
      )
    }
  }, [authLoading, user, awaitingHandoff, navigate, location.pathname, location.search])

  // B5: fetch the effective node/model availability once per session — the
  // admin runtime override can't ride the static /config.js profile, so the
  // picker / model-dropdown filters read this fetched set (profile deny is
  // their pre-fetch fallback; the backend refuses denied types regardless).
  // Keyed on the user: the answer is per viewer (an admin's includes nodes their
  // users must not be offered), so it is dropped on sign-out and on a change of
  // account instead of lingering until — or unless — the next fetch lands.
  useEffect(() => {
    if (authLoading) return
    if (user) void loadSurfaceAvailability(getAuthHeaders, user.id)
    else resetSurfaceAvailability()
  }, [authLoading, user])

  // Engine readiness for 3D Render Pro — the picker hides the node until the
  // install answers "yes". Same authenticated, once-per-session shape as the
  // availability fetch above.
  useEffect(() => {
    if (!authLoading && user) void loadScene3DProAvailability(getAuthHeaders)
  }, [authLoading, user])

  // Which Edit Plan modes the server plans — the panel greys out Trailer until
  // the answer says so. Unlike the fetches above, this answer can change
  // mid-session (a connected self-host follows nodaro.ai's), so the watcher
  // also refreshes a stale answer when the window regains focus.
  useEffect(() => {
    if (authLoading || !user) return
    return watchEditPlanModes(getAuthHeaders)
  }, [authLoading, user])

  // After OAuth login, check for a pending plan selection and redirect to pricing.
  // Not from a prerendered page nobody has seen yet: it would spend the key.
  useEffect(() => whenActivated(() => {
    // Nothing to buy without billing — a leftover key would navigate to a
    // page this edition doesn't serve.
    if (!hasCredits()) {
      localStorage.removeItem("nodaro_pending_plan")
      return
    }
    const pendingPlan = localStorage.getItem("nodaro_pending_plan")
    if (pendingPlan) {
      localStorage.removeItem("nodaro_pending_plan")
      navigate(`/pricing?plan=${encodeURIComponent(pendingPlan)}`, { replace: true })
    }
  }), [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // The shared site header replaces the sidebar's own chrome (one gate for the
  // layout, the sidebar and the editor toolbar).
  const sharedHeader = useSharedHeaderActive()

  // Show loading state while checking auth
  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const sidebar = !embedded && (
    <AppSidebar
      defaultCollapsed={isEditor}
      isMobileOpen={mobileMenuOpen}
      onMobileClose={() => setMobileMenuOpen(false)}
    />
  )
  const column = (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Only show mobile header on non-editor pages (and never when embedded,
          or under the shared site header, which has its own phone rows) */}
      {!isEditor && !embedded && !sharedHeader && <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />}
      {/* Withheld free grant → activation path. Self-hiding; cloud only. */}
      {!embedded && <FreeGrantBannerSlot />}
      {/* The editor paints its own canvas ground; every other page gets the
          ambient wash (globals.css .page-ambient) under its content. */}
      <main className={isEditor ? "flex-1 overflow-auto" : "flex-1 overflow-auto page-ambient"}>
        <Outlet />
      </main>
    </div>
  )

  return (
    <SidebarProvider defaultCollapsed={isEditor}>
      {sharedHeader ? (
        // The shared site header (Cloud, lib/shared-header.ts) above the
        // sidebar row; the row takes the rest of the screen.
        <div className="flex h-screen flex-col bg-background">
          <SiteHeaderSlot
            compact={isEditor}
            onOpenMenu={() => setMobileMenuOpen(true)}
            onHeaderOverlay={() => setMobileMenuOpen(false)}
          />
          <div className="flex min-h-0 flex-1">
            {sidebar}
            {column}
          </div>
        </div>
      ) : (
        <div className="flex h-screen bg-background">
          {sidebar}

          {column}
        </div>
      )}
      {/* Marketing-email consent nag (Cloud-only, self-hiding, never in an embed). */}
      <ConsentGateSlot />
      {/* Welcome credits popup: once on first visit, and on a refused create (Cloud-only, self-hiding).
          Under the shared site header its own dialog owns both (one listener
          for the consent ask, never two dialogs), so the app's stays out. */}
      {!sharedHeader && <WelcomeOfferPopupSlot />}
    </SidebarProvider>
  )
}
