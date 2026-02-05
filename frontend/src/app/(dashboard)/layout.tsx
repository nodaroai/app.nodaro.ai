"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { AppSidebar, MobileHeader } from "@/components/layout/app-sidebar"

export default function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Check if we're in the editor - auto-collapse sidebar
  const isEditor = pathname.includes("/workflows/")

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // For editor routes, render children directly without the dashboard shell
  // The editor has its own layout with floating toolbar
  if (isEditor) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar
        isMobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
