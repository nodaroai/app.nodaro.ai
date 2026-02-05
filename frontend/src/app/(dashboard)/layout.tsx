"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { AppSidebar, MobileHeader } from "@/components/layout/app-sidebar"
import { SidebarProvider } from "@/components/layout/sidebar-context"

export default function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Check if we're in the editor - sidebar starts collapsed but can be expanded
  const isEditor = pathname.includes("/workflows/")

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

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
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  )
}
