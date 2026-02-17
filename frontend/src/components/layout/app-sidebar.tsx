import { useEffect, useState, useCallback } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  FolderOpen,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  CreditCard,
  Sparkles,
  Images,
  Archive,
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
import { APP_VERSION } from "@/lib/version"
import { useSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "./sidebar-context"

const STORAGE_KEY = "scenenode-sidebar-collapsed"
const API_BASE = ""
const REPORT_POLL_INTERVAL = 60_000

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly adminOnly?: boolean
  readonly billingOnly?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/gallery", label: "Gallery", icon: Images },
  { href: "/library", label: "Library", icon: Archive },
  { href: "/pricing", label: "Pricing", icon: Sparkles, billingOnly: true },
  { href: "/billing", label: "Billing", icon: CreditCard, billingOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
]

interface AppSidebarProps {
  /** If true, sidebar starts collapsed but can still be expanded by user */
  readonly defaultCollapsed?: boolean
  readonly onMobileClose?: () => void
  readonly isMobileOpen?: boolean
  readonly className?: string
}

export function AppSidebar({
  defaultCollapsed = false,
  onMobileClose,
  isMobileOpen = false,
  className,
}: AppSidebarProps) {
  const pathname = useLocation().pathname
  const { user, isAdmin, signOut } = useAuth()
  const { isCollapsed, setCollapsed } = useSidebar()
  const [mounted, setMounted] = useState(false)
  const [initializedFromStorage, setInitializedFromStorage] = useState(false)
  const [pendingReportsCount, setPendingReportsCount] = useState(0)

  // Poll pending gallery reports count for admin badge
  useEffect(() => {
    if (!isAdmin || !user?.id) return

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
  }, [isAdmin, user?.id])

  // Load collapsed state from localStorage on mount, respecting defaultCollapsed
  useEffect(() => {
    if (initializedFromStorage) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (defaultCollapsed) {
      // For editor, always start collapsed
      setCollapsed(true)
    } else if (stored !== null) {
      // For non-editor pages, use stored preference
      setCollapsed(stored === "true")
    }
    setInitializedFromStorage(true)
    setMounted(true)
  }, [defaultCollapsed, setCollapsed, initializedFromStorage])

  // When navigating to editor, auto-collapse on initial load only (not on every toggle)
  // This runs once when defaultCollapsed becomes true (entering editor)
  useEffect(() => {
    if (defaultCollapsed && mounted) {
      setCollapsed(true)
    }
    // Intentionally omit isCollapsed - we only want this to run when entering editor page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCollapsed, mounted])

  const toggleCollapsed = useCallback(() => {
    const newValue = !isCollapsed
    setCollapsed(newValue)
    localStorage.setItem(STORAGE_KEY, String(newValue))
  }, [isCollapsed, setCollapsed])

  const handleNavClick = () => {
    onMobileClose?.()
  }

  // Don't render with wrong state during hydration
  if (!mounted) {
    return null
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r transition-all duration-300 ease-in-out md:static",
          // Theme-aware background
          "bg-white dark:bg-zinc-950",
          // Theme-aware border
          "border-zinc-200 dark:border-zinc-800",
          isCollapsed ? "w-14" : "w-56",
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          className,
        )}
      >
        {/* Logo - matches editor header height (h-[41px] = py-2 + border-b) */}
        <div className="flex items-center justify-between h-[41px] px-3 border-b border-zinc-200 dark:border-zinc-800">
          <Link
            to="/projects"
            onClick={handleNavClick}
            className={cn(
              "flex items-center gap-2 font-bold text-[#ff0073] transition-all duration-300",
              isCollapsed ? "justify-center w-full" : "",
            )}
          >
            {isCollapsed ? (
              <span className="text-lg">S</span>
            ) : (
              <span className="text-lg">SceneNode</span>
            )}
          </Link>
          {/* Mobile close button */}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 md:hidden text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
              onClick={onMobileClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            // Skip admin item if not admin or feature not enabled
            if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) {
              return null
            }
            // Skip billing items if billing feature not enabled
            if (item.billingOnly && !isFeatureEnabled("billing")) {
              return null
            }

            const isActive = item.href === "/admin"
              ? pathname.startsWith("/admin")
              : pathname === item.href || pathname.startsWith(item.href + "/")

            const showBadge = item.adminOnly && pendingReportsCount > 0

            const linkContent = (
              <Link
                to={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                  isCollapsed ? "justify-center px-0" : "",
                  isActive
                    ? "bg-pink-50 dark:bg-[#ff0073]/10 text-[#ff0073] border-l-2 border-[#ff0073] -ml-0.5 pl-[10px]"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                )}
              >
                <span className="relative flex-shrink-0">
                  <item.icon className={cn("h-5 w-5", isActive && "text-[#ff0073]")} />
                  {showBadge && isCollapsed && (
                    <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-[#ff0073]" />
                  )}
                </span>
                {!isCollapsed && (
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

            if (isCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                  >
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
          {/* Version */}
          <div className="text-center">
            <span className="text-xs text-muted-foreground">
              {isCollapsed ? `v${APP_VERSION.split(".").slice(0, 2).join(".")}` : `v${APP_VERSION}`}
            </span>
          </div>

          {/* Collapse toggle */}
          <div className="hidden md:block">
            {isCollapsed ? (
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
                <TooltipContent
                  side="right"
                  className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                >
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
                isCollapsed ? "justify-center" : "justify-between",
              )}
            >
              {isCollapsed ? (
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
                  <TooltipContent
                    side="right"
                    className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                  >
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
                    <TooltipContent
                      side="right"
                      className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                    >
                      Sign out
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          )}

          {/* Theme toggle */}
          {isCollapsed ? (
            <div className="flex justify-center">
              <ThemeToggle />
            </div>
          ) : (
            <ThemeToggle />
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}

interface MobileHeaderProps {
  readonly onMenuClick: () => void
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 md:hidden">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="text-sm font-bold text-[#ff0073]">SceneNode</span>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  )
}

// Re-export width constants for backward compatibility
export { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH }
