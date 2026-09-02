import { useState, useEffect } from "react"
import { hasCredits } from "@/lib/edition"
import { useLocation, useNavigate, Outlet } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppSidebar, MobileHeader } from "@/components/layout/app-sidebar"
import { FreeGrantBannerSlot } from "@/components/layout/free-grant-banner-slot"
import { ConsentGateSlot } from "@/components/layout/consent-gate-slot"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { useLoadUserSettings } from "@/hooks/use-load-user-settings"
import { useAuth } from "@/hooks/use-auth"
import { useEmbedSessionHandoff, isEmbedded } from "@/hooks/use-embed-session-handoff"
import { loadSurfaceAvailability } from "@/lib/surface-availability"
import { getAuthHeaders } from "@/lib/api"

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
  const isEditor = location.pathname.includes("/workflows/")

  // When this app is rendered inside a cross-origin iframe (e.g. studio.nodaro.ai
  // embeds /billing or /pricing as a chromeless modal), drop the app chrome
  // (sidebar + mobile header) so only the page content shows. The session is
  // still adopted via useEmbedSessionHandoff above, so auth-gated pages work.
  const embedded = isEmbedded()

  // Redirect unauthenticated users to login (unless an embed session handoff
  // is still pending — see useEmbedSessionHandoff).
  useEffect(() => {
    if (!authLoading && !user && !awaitingHandoff) {
      navigate("/login", { replace: true })
    }
  }, [authLoading, user, awaitingHandoff, navigate])

  // B5: fetch the effective node/model availability once per session — the
  // admin runtime override can't ride the static /config.js profile, so the
  // picker / model-dropdown filters read this fetched set (profile deny is
  // their pre-fetch fallback; the backend refuses denied types regardless).
  useEffect(() => {
    if (!authLoading && user) void loadSurfaceAvailability(getAuthHeaders)
  }, [authLoading, user])

  // After OAuth login, check for a pending plan selection and redirect to pricing
  useEffect(() => {
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
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Show loading state while checking auth
  if (authLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <SidebarProvider defaultCollapsed={isEditor}>
      <div className="flex h-screen bg-background">
        {!embedded && (
          <AppSidebar
            defaultCollapsed={isEditor}
            isMobileOpen={mobileMenuOpen}
            onMobileClose={() => setMobileMenuOpen(false)}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Only show mobile header on non-editor pages (and never when embedded) */}
          {!isEditor && !embedded && <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />}
          {/* Withheld free grant → activation path. Self-hiding; cloud only. */}
          {!embedded && <FreeGrantBannerSlot />}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      {/* Marketing-email consent nag (Cloud-only, self-hiding, never in an embed). */}
      <ConsentGateSlot />
    </SidebarProvider>
  )
}
