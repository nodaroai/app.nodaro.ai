import { useEffect, useState, useCallback } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useGalleryReportCount } from "@/hooks/queries/use-gallery-queries"
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
  Images,
  Archive,
  History,
  Plug,
  Rocket,
  Coins,
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
import { isFeatureEnabled, hasCredits } from "@/lib/edition"
import { useUserCredits } from "@/hooks/queries/use-credits-queries"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { APP_VERSION } from "@/lib/version"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "./sidebar-context"

const STORAGE_KEY = "nodaro-sidebar-collapsed"

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly adminOnly?: boolean
  readonly billingOnly?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/apps", label: "My Apps", icon: Rocket },
  { href: "/executions", label: "Executions", icon: History },
  { href: "/library", label: "Library", icon: Archive },
  { href: "/_gallery", label: "Gallery", icon: Images },
  { href: "/integrations", label: "Integrations", icon: Plug },
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
  const navigate = useNavigate()
  const { user, isAdmin, signOut } = useAuth()
  const { isCollapsed, setCollapsed } = useSidebar()
  const { data: creditBalance } = useUserCredits(user?.id)
  const [mounted, setMounted] = useState(false)
  const [initializedFromStorage, setInitializedFromStorage] = useState(false)
  const { data: pendingReportsCount = 0 } = useGalleryReportCount()

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    if (initializedFromStorage) return

    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      setCollapsed(stored === "true")
    }
    setInitializedFromStorage(true)
    setMounted(true)
  }, [setCollapsed, initializedFromStorage])

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
              "flex items-center gap-2 transition-all duration-300",
              isCollapsed ? "justify-center w-full" : "ml-1",
            )}
          >
            {isCollapsed ? (
              <NodaroLogo variant="icon" size="md" />
            ) : (
              <NodaroLogo size="md" />
            )}
          </Link>
          {/* Mobile close button */}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close sidebar"
              className="h-8 w-8 p-0 md:hidden text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
              onClick={onMobileClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Credit card */}
        {hasCredits() && creditBalance && (
          isCollapsed ? (
            <div className="px-2 pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => navigate("/billing")}
                    className="w-full h-9 flex items-center justify-center gap-1 rounded-md text-xs font-medium text-[#ff0073] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Coins className="h-4 w-4" />
                    <span className="font-mono text-[11px]">{creditBalance.total}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                >
                  <p>{creditBalance.total} credits left</p>
                  {creditBalance.tier === "free" ? (
                    creditBalance.dailyLimit != null && (
                      <p className="text-zinc-500 dark:text-zinc-400">Today &middot; {creditBalance.dailyLimit - creditBalance.dailySpent} credits left</p>
                    )
                  ) : creditBalance.periodEnd ? (
                    <p className="text-zinc-500 dark:text-zinc-400">
                      Renews {(() => {
                        const end = new Date(creditBalance.periodEnd)
                        const now = new Date()
                        const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        if (daysLeft <= 14) return `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
                        return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      })()}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div
              className="mx-2 mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left"
              onClick={() => navigate("/billing")}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
                    {creditBalance.tier === "free" ? "Free Plan" : `${creditBalance.tier} Plan`}
                  </span>
                  {(creditBalance.tier === "free" || creditBalance.total <= (PRICING_TIERS.find((t) => t.id === creditBalance.tier)?.credits ?? 150) * 0.1) && (
                    <Link
                      to="/_pricing"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] font-medium text-[#ff0073] hover:text-[#ff0073]/80 px-1.5 py-0.5 rounded border border-[#ff0073]/30 hover:bg-[#ff0073]/10 transition-colors"
                    >
                      Upgrade
                    </Link>
                  )}
                </div>
                {(() => {
                  const tierAllocation = PRICING_TIERS.find((t) => t.id === creditBalance.tier)?.credits ?? 150
                  const remainPercent = Math.min(100, Math.max(0, Math.round((creditBalance.total / tierAllocation) * 100)))
                  return (
                    <>
                      <p className="text-sm font-semibold text-[#ff0073] font-mono">
                        {creditBalance.total} <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">credits left</span>
                      </p>
                      <div className="mt-1 w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#ff0073] transition-all"
                          style={{ width: `${remainPercent}%` }}
                        />
                      </div>
                    </>
                  )
                })()}
              </div>
              {creditBalance.tier === "free" ? (
                creditBalance.dailyLimit != null && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Today &middot; <span className="font-mono text-zinc-600 dark:text-zinc-300">{creditBalance.dailyLimit - creditBalance.dailySpent}</span> credits left
                  </p>
                )
              ) : (
                <div className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {(() => {
                    const tierAllocation = PRICING_TIERS.find((t) => t.id === creditBalance.tier)?.credits ?? 0
                    return tierAllocation > 0 && (
                      <p>Monthly limit: <span className="font-mono text-zinc-600 dark:text-zinc-300">{tierAllocation}</span></p>
                    )
                  })()}
                  {creditBalance.periodEnd && (
                    <p>
                      Renews {(() => {
                        const end = new Date(creditBalance.periodEnd)
                        const now = new Date()
                        const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        if (daysLeft <= 14) return `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
                        return end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                      })()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        )}

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
                aria-label={item.label}
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
                      aria-label="Sign out"
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
                        aria-label="Sign out"
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

          {/* Collapse toggle + Theme toggle */}
          <div className={cn("flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
            <div className="hidden md:block">
              {isCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Expand sidebar"
                      className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
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
                  className="h-8 gap-2 px-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                  onClick={toggleCollapsed}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="text-sm">Collapse</span>
                </Button>
              )}
            </div>
            {!isCollapsed && <ThemeToggle />}
          </div>

          {/* Version */}
          <div className="text-center">
            <span className="text-xs text-muted-foreground">
              {isCollapsed ? `v${APP_VERSION.split(".").slice(0, 2).join(".")}` : `v${APP_VERSION}`}
            </span>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}

interface MobileHeaderProps {
  readonly onMenuClick: () => void
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const location = useLocation()
  const isDashboard = location.pathname === "/projects"

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 md:hidden">
      {!isDashboard && (
        <Link
          to="/projects"
          className="h-8 w-8 p-0 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 touch-manipulation"
          aria-label="Back to projects"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Open menu"
        className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <NodaroLogo size="sm" />
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  )
}

// Re-export width constants for backward compatibility
export { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH }
