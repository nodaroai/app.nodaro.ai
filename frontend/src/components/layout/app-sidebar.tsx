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
  LayoutTemplate,
  Coins,
  Sparkles,
  Compass,
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
import { isFeatureEnabled, hasCredits, isMultiUser } from "@/lib/edition"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { APP_VERSION } from "@/lib/version"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "./sidebar-context"

const STORAGE_KEY = "nodaro-sidebar-collapsed"

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  readonly adminOnly?: boolean
  readonly billingOnly?: boolean
  readonly multiUserOnly?: boolean
}

interface NavSection {
  readonly label: string
  readonly items: readonly NavItem[]
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "WORKSPACE",
    items: [
      { href: "/projects", label: "Projects", icon: FolderOpen },
      { href: "/apps", label: "Apps", icon: Rocket },
      { href: "/templates", label: "Templates", icon: LayoutTemplate },
      { href: "/explore", label: "Explore", icon: Compass, multiUserOnly: true },
    ]
  },
  {
    label: "ACTIVITY",
    items: [
      { href: "/executions", label: "Executions", icon: History },
      { href: "/my-files", label: "My Files", icon: Archive },
      { href: "/_gallery", label: "Gallery", icon: Images },
    ]
  },
  {
    label: "ACCOUNT",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/_pricing", label: "Pricing", icon: Sparkles, billingOnly: true },
      { href: "/billing", label: "Billing", icon: CreditCard, billingOnly: true },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
      { href: "/admin/community-reports", label: "Community Reports", icon: Flag, adminOnly: true },
    ]
  },
]

const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(s => s.items)

function formatRenewalTime(periodEnd: string): string | null {
  const msLeft = new Date(periodEnd).getTime() - Date.now()
  if (msLeft <= 0) return null  // stale date — don't show misleading text
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))
  if (daysLeft < 1) {
    const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60))
    if (hoursLeft >= 1) return `in ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}`
    const minutesLeft = Math.floor(msLeft / (1000 * 60))
    if (minutesLeft >= 1) return `in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`
    return "in less than a minute"
  }
  if (daysLeft <= 14) return `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
  return new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

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

  // The top-level Admin item points at /admin and would greedily match every
  // /admin/* subpath; treat it as active only when no more-specific nav item
  // (e.g. /admin/community-reports) owns the current path.
  const isNavItemActive = (href: string): boolean => {
    if (href === "/admin") {
      if (pathname === "/admin") return true
      const hasSpecificMatch = NAV_ITEMS.some(
        (i) => i.href !== "/admin" && i.href.startsWith("/admin/") && pathname.startsWith(i.href),
      )
      return pathname.startsWith("/admin/") && !hasSpecificMatch
    }
    return pathname === href || pathname.startsWith(href + "/")
  }
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
                    className="w-full h-9 flex items-center justify-center gap-1 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Coins className="h-4 w-4" strokeWidth={1.5} />
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
                      <p className="text-zinc-500 dark:text-zinc-400">Daily limit &middot; {Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent)} credits left</p>
                    )
                  ) : creditBalance.periodEnd && formatRenewalTime(creditBalance.periodEnd) ? (
                    <p className="text-zinc-500 dark:text-zinc-400">
                      Renews {formatRenewalTime(creditBalance.periodEnd)}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div
              className="mx-2 mt-2 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 p-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-left"
              onClick={() => navigate("/billing")}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  {creditBalance.tier === "free" ? "Free Plan" : `${creditBalance.tier.charAt(0).toUpperCase() + creditBalance.tier.slice(1)} Plan`}
                </span>
                {(creditBalance.tier === "free" || creditBalance.total <= (PRICING_TIERS.find((t) => t.id === creditBalance.tier)?.credits ?? 150) * 0.1) && (
                  <Link
                    to="/_pricing"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-medium text-[#ff0073] hover:text-[#ff0073]/80 transition-colors"
                  >
                    Upgrade →
                  </Link>
                )}
              </div>

              <div className="mb-3">
                <span className="text-2xl font-bold text-zinc-900 dark:text-white font-mono tracking-tight">
                  {creditBalance.total.toLocaleString()}
                </span>
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">credits</span>
              </div>

              {(() => {
                const tierAllocation = PRICING_TIERS.find((t) => t.id === creditBalance.tier)?.credits ?? 150
                const remainPercent = Math.min(100, Math.max(0, Math.round((creditBalance.total / tierAllocation) * 100)))
                return (
                  <div className="mb-3">
                    <div className="w-full h-[2px] bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#ff0073] transition-all"
                        style={{ width: `${remainPercent}%` }}
                      />
                    </div>
                  </div>
                )
              })()}

              <div className="space-y-0.5">
                {creditBalance.tier === "free" ? (
                  creditBalance.dailyLimit != null && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
                      <span className="font-mono text-zinc-600 dark:text-zinc-400">{Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent)}</span> daily credits left
                    </p>
                  )
                ) : (
                  <>
                    {creditBalance.periodEnd && formatRenewalTime(creditBalance.periodEnd) && (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
                        Renews {formatRenewalTime(creditBalance.periodEnd)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-1">
          {isCollapsed ? (
            // Collapsed: flat icon list, no labels
            NAV_ITEMS.map((item) => {
              if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return null
              if (item.billingOnly && !isFeatureEnabled("billing")) return null
              if (item.multiUserOnly && !isMultiUser()) return null

              const isActive = isNavItemActive(item.href)

              const showBadge = item.href === "/admin" && pendingReportsCount > 0

              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.href}
                      onClick={handleNavClick}
                      aria-label={item.label}
                      className={cn(
                        "flex items-center justify-center w-full h-9 rounded-md transition-all duration-200",
                        isActive
                          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                      )}
                    >
                      <span className="relative">
                        <item.icon className="h-4 w-4" strokeWidth={1.5} />
                        {showBadge && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                        )}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              )
            })
          ) : (
            // Expanded: sections with labels
            NAV_SECTIONS.map((section) => {
              const visibleItems = section.items.filter((item) => {
                if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return false
                if (item.billingOnly && !isFeatureEnabled("billing")) return false
                if (item.multiUserOnly && !isMultiUser()) return false
                return true
              })

              if (visibleItems.length === 0) return null

              return (
                <div key={section.label} className="mb-4">
                  <p className="px-3 mb-1 text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">
                    {section.label}
                  </p>
                  {visibleItems.map((item) => {
                    const isActive = isNavItemActive(item.href)

                    const showBadge = item.href === "/admin" && pendingReportsCount > 0

                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={handleNavClick}
                        aria-label={item.label}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                          isActive
                            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white border-l-2 border-zinc-400 dark:border-zinc-500 -ml-0.5 pl-[10px]"
                            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                        )}
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        <span>{item.label}</span>
                        {showBadge && (
                          <span className="ml-auto px-1.5 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full">
                            {pendingReportsCount}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )
            })
          )}
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
                      <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 text-xs font-medium">
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
                    <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 text-xs font-medium flex-shrink-0">
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
