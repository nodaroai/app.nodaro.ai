"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3,
  Users,
  Briefcase,
  Activity,
  ArrowLeft,
  LogOut,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Bell,
  Cpu,
  DollarSign,
  Flag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isFeatureEnabled } from "@/lib/edition"

const STORAGE_KEY = "scenenode-admin-sidebar-collapsed"
const API_BASE = ""
const REPORT_POLL_INTERVAL = 60_000

const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/admin/usage", label: "Usage", icon: Activity },
  { href: "/admin/alerts", label: "Alerts", icon: Bell },
  { href: "/admin/models", label: "Models", icon: Cpu },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  { href: "/admin/pricing", label: "Pricing", icon: DollarSign },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const

export default function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAdmin, loading, roleLoaded, signOut } = useAuth()
  const [checked, setChecked] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pendingReportsCount, setPendingReportsCount] = useState(0)

  // Poll pending gallery reports count for badge
  useEffect(() => {
    if (!user?.id || !isAdmin) return

    let cancelled = false

    async function fetchCount() {
      try {
        const response = await fetch(`${API_BASE}/v1/admin/gallery-reports/count?userId=${user!.id}`)
        if (!response.ok) return
        const json = await response.json()
        if (!cancelled) {
          setPendingReportsCount(json.count ?? 0)
        }
      } catch {
        // Badge is non-critical
      }
    }

    fetchCount()
    const interval = setInterval(fetchCount, REPORT_POLL_INTERVAL)
    return () => { cancelled = true; clearInterval(interval) }
  }, [user?.id, isAdmin])

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      setCollapsed(stored === "true")
    }
    setMounted(true)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/projects")
      return
    }
    // Wait for role to be fetched before making admin decision
    if (!roleLoaded) return
    if (!isFeatureEnabled("adminPanel") || !isAdmin) {
      router.replace("/projects")
    } else {
      setChecked(true)
    }
  }, [user, isAdmin, loading, roleLoaded, router])

  const toggleCollapsed = () => {
    const newValue = !collapsed
    setCollapsed(newValue)
    localStorage.setItem(STORAGE_KEY, String(newValue))
  }

  if (!checked || !mounted) {
    return (
      <div className="flex justify-center items-center h-screen bg-background">
        <div className="animate-spin h-6 w-6 border-2 border-[#ff0073] border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen bg-background">
        {/* Mobile overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex flex-col border-r transition-all duration-300 ease-in-out md:static",
            // Theme-aware background
            "bg-white dark:bg-zinc-950",
            // Theme-aware border
            "border-zinc-200 dark:border-zinc-800",
            collapsed ? "w-14" : "w-56",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          )}
        >
          {/* Header */}
          <div className="flex items-center h-14 px-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className={cn("flex items-center gap-2", collapsed ? "justify-center w-full" : "")}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href="/projects">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700">
                    Back to Projects
                  </TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Link href="/projects">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                  <span className="text-lg font-bold text-[#ff0073]">Admin</span>
                </>
              )}
            </div>
            {/* Mobile close button */}
            {!collapsed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 ml-auto md:hidden text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-3 flex flex-col gap-1">
            {ADMIN_NAV.map((item) => {
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href)

              const isReportsItem = item.href === "/admin/reports"
              const showBadge = isReportsItem && pendingReportsCount > 0

              const linkContent = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                    collapsed ? "justify-center px-0" : "",
                    isActive
                      ? "bg-pink-50 dark:bg-[#ff0073]/10 text-[#ff0073] border-l-2 border-[#ff0073] -ml-0.5 pl-[10px]"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                  )}
                >
                  <span className="relative flex-shrink-0">
                    <item.icon className={cn("h-5 w-5", isActive && "text-[#ff0073]")} />
                    {showBadge && collapsed && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#ff0073]" />
                    )}
                  </span>
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      {showBadge && (
                        <span className="ml-auto px-1.5 py-0.5 text-xs font-medium bg-[#ff0073] text-white rounded-full">
                          {pendingReportsCount}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" className="bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return <div key={item.href}>{linkContent}</div>
            })}
          </nav>

          {/* Bottom section */}
          <div className="px-2 py-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
            {/* Collapse toggle */}
            <div className="hidden md:block">
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-9 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                      onClick={toggleCollapsed}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700">
                    Expand sidebar
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full h-9 justify-start gap-3 px-3 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                  onClick={toggleCollapsed}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="text-sm">Collapse</span>
                </Button>
              )}
            </div>

            {/* User info */}
            {user && (
              <div
                className={cn(
                  "flex items-center gap-2",
                  collapsed ? "justify-center" : "justify-between",
                )}
              >
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                        onClick={signOut}
                      >
                        <div className="h-6 w-6 rounded-full bg-[#ff0073]/20 flex items-center justify-center text-[#ff0073] text-xs font-medium">
                          {user.email?.[0]?.toUpperCase() || "U"}
                        </div>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700">
                      <div className="text-xs">{user.email}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Click to sign out</div>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-6 w-6 rounded-full bg-[#ff0073]/20 flex items-center justify-center text-[#ff0073] text-xs font-medium flex-shrink-0">
                        {user.email?.[0]?.toUpperCase() || "U"}
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{user.email}</span>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 flex-shrink-0"
                          onClick={signOut}
                        >
                          <LogOut className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="bg-white text-zinc-900 border-zinc-200 dark:bg-zinc-800 dark:text-white dark:border-zinc-700">
                        Sign out
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            )}

            {/* Theme toggle */}
            {collapsed ? (
              <div className="flex justify-center">
                <ThemeToggle />
              </div>
            ) : (
              <ThemeToggle />
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile header */}
          <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="text-sm font-bold text-[#ff0073]">Admin</span>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
