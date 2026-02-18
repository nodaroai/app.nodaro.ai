import { useState, useEffect } from "react"
import { useLocation, useNavigate, Outlet } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { AppSidebar, MobileHeader } from "@/components/layout/app-sidebar"
import { SidebarProvider } from "@/components/layout/sidebar-context"
import { useLoadUserSettings } from "@/hooks/use-load-user-settings"
import { useAuth } from "@/hooks/use-auth"

export default function DashboardLayout() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Load user prompt templates into workflow store on app init
  useLoadUserSettings()

  // Check if we're in the editor - sidebar starts collapsed but can be expanded
  const isEditor = location.pathname.includes("/workflows/")

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login", { replace: true })
    }
  }, [authLoading, user, navigate])

  // After OAuth login, check for a pending plan selection and redirect to pricing
  useEffect(() => {
    const pendingPlan = localStorage.getItem("scenenode_pending_plan")
    if (pendingPlan) {
      localStorage.removeItem("scenenode_pending_plan")
      navigate(`/_pricing?plan=${encodeURIComponent(pendingPlan)}`, { replace: true })
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
        <AppSidebar
          defaultCollapsed={isEditor}
          isMobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Only show mobile header on non-editor pages */}
          {!isEditor && <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  )
}
