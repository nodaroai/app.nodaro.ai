import { useCallback, useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useGalleryReportCount } from "@/hooks/queries/use-gallery-queries"
import {
  FolderOpen,
  Settings,
  Shield,
  CreditCard,
  Images,
  Archive,
  Bookmark,
  Database,
  Radar,
  History,
  Plug,
  Rocket,
  LayoutTemplate,
  Coins,
  Wallet,
  Sparkles,
  Compass,
  Flag,
  Clapperboard,
  GraduationCap,
} from "lucide-react"
import { useT, type MessageKey } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isFeatureEnabled, isMultiUser } from "@/lib/edition"
import { useDeploymentPayerViewer } from "@/ee/hooks/queries/use-deployment-billing"
import { surfaceNavHidden, surfaceTabs, surfaceBillingSelfServe } from "@/lib/surface-selectors"
import type { DashboardTabKey, NavKey } from "@/lib/surface-profile"
import { useSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "./sidebar-context"
import { useSharedHeaderActive } from "@/lib/shared-header"
import { SidebarBrandStrip, SidebarHeaderModeStrip } from "./sidebar-brand-strip"
import { SidebarCreditCard } from "./sidebar-credit-card"
import { SidebarFooter } from "./sidebar-footer"

const STORAGE_KEY = "nodaro-sidebar-collapsed"

interface NavItem {
  readonly href: string
  readonly label: MessageKey
  readonly icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  readonly adminOnly?: boolean
  readonly billingOnly?: boolean
  /** Rendered only on a billing edition WITHOUT self-serve purchase (a prepaid
   *  instance): those deployments lose the Pricing/Billing entries, and this is
   *  their replacement destination (e.g. Usage). Mainline self-serve cloud
   *  never renders it, so the stock sidebar is byte-identical. */
  readonly prepaidOnly?: boolean
  readonly multiUserOnly?: boolean
  /** Rendered only for the deployment's BILLING ACCOUNT — the one identity that
   *  may reach /billing-admin. Absent on mainline, where the billing surface
   *  answers `deploymentPayer: false` and the probe never fires. */
  readonly payerOnly?: boolean
  /** Query string for destinations that are a tab rather than a route, e.g.
   *  Tutorials lives at /projects?tab=explore. Also disambiguates the active
   *  state from the plain item on the same path. */
  readonly search?: string
  /** Kept in the list but not rendered. Hidden rather than deleted so turning
   *  one back on is a one-word change and the route itself still works for
   *  anyone holding a direct link. */
  readonly hidden?: boolean
  /** The home-screen section this entry is the doorway to. A deployment that
   *  leaves the key out of `dashboard.tabs` hides the section AND this entry —
   *  Templates, Tutorials and MiniApps used to be reachable only through the
   *  home screen's discovery strip, which that whitelist governs, so a narrowed
   *  deployment keeps exactly the surface it had. */
  readonly dashboardKey?: DashboardTabKey
}

interface NavSection {
  readonly label: MessageKey
  readonly items: readonly NavItem[]
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "nav.section.workspace",
    items: [
      { href: "/projects", label: "nav.projects", icon: FolderOpen },
      { href: "/templates", label: "nav.templates", icon: LayoutTemplate, dashboardKey: "templates" },
      // The tutorials live on the home screen's Explore tab (Level up).
      { href: "/projects", search: "?tab=explore", label: "nav.tutorials", icon: GraduationCap, dashboardKey: "tutorials" },
      { href: "/explore", label: "nav.explore", icon: Compass, multiUserOnly: true },
      { href: "/apps", label: "nav.miniapps", icon: Rocket, dashboardKey: "miniapps" },
      { href: "/video-director", label: "nav.videoDirector", icon: Clapperboard, hidden: true },
    ]
  },
  {
    label: "nav.section.activity",
    items: [
      { href: "/executions", label: "nav.executions", icon: History },
      { href: "/my-files", label: "nav.myFiles", icon: Archive },
      { href: "/inspiration", label: "nav.inspiration", icon: Bookmark, adminOnly: true },
      { href: "/collections", label: "nav.collections", icon: Database, adminOnly: true },
      { href: "/competitors", label: "nav.competitors", icon: Radar, adminOnly: true },
      { href: "/_gallery", label: "nav.gallery", icon: Images },
    ]
  },
  {
    label: "nav.section.account",
    items: [
      { href: "/integrations", label: "nav.integrations", icon: Plug },
      { href: "/pricing", label: "nav.pricing", icon: Sparkles, billingOnly: true },
      { href: "/billing", label: "nav.billing", icon: CreditCard, billingOnly: true },
      { href: "/usage", label: "nav.usage", icon: Coins, prepaidOnly: true },
      { href: "/billing-admin", label: "billingAdmin.navLabel", icon: Wallet, payerOnly: true },
      { href: "/settings", label: "nav.settings", icon: Settings },
      { href: "/admin", label: "nav.admin", icon: Shield, adminOnly: true },
      { href: "/admin/community-reports", label: "nav.communityReports", icon: Flag, adminOnly: true },
    ]
  },
]

export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(s => s.items)

/** Sidebar items whose visibility a deployment surface profile can hide (B1). */
const NAV_HREF_TO_SURFACE_KEY: Partial<Record<string, NavKey>> = {
  "/_gallery": "gallery",
  "/pricing": "pricing",
  "/explore": "explore",
  "/apps": "apps",
  "/templates": "templates",
  "/integrations": "integrations",
}

/**
 * True when the deployment surface profile hides this item's nav entry —
 * through `nav.hide`, or through a `dashboard.tabs` whitelist that leaves out
 * the section the entry leads to (see `dashboardKey`). Exported for the test.
 */
export function isNavItemSurfaceHidden(item: NavItem): boolean {
  const key = NAV_HREF_TO_SURFACE_KEY[item.href]
  if (key && surfaceNavHidden(key)) return true
  return item.dashboardKey !== undefined && surfaceTabs([item.dashboardKey]).length === 0
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
  const t = useT()
  const { pathname, search } = useLocation()

  // The top-level Admin item points at /admin and would greedily match every
  // /admin/* subpath; treat it as active only when no more-specific nav item
  // (e.g. /admin/community-reports) owns the current path.
  const isNavItemActive = (item: NavItem): boolean => {
    if (item.href === "/admin") {
      if (pathname === "/admin") return true
      const hasSpecificMatch = NAV_ITEMS.some(
        (i) => i.href !== "/admin" && i.href.startsWith("/admin/") && pathname.startsWith(i.href),
      )
      return pathname.startsWith("/admin/") && !hasSpecificMatch
    }
    if (!(pathname === item.href || pathname.startsWith(item.href + "/"))) return false
    // Tabs share a path with the plain item, so exactly one of them lights up:
    // the tab when its query matches, the plain item when no sibling's does.
    if (item.search) return search === item.search
    return !NAV_ITEMS.some((i) => i.search && i.href === item.href && search === i.search)
  }
  const { isAdmin } = useAuth()
  // Track A — is THIS viewer the deployment's billing account? Fail-closed:
  // false while the probe is pending, and false on every deployment without a
  // payer, so the stock sidebar is byte-identical. Shares its query key with
  // the page, so this costs no extra request.
  const { isPayer } = useDeploymentPayerViewer()
  const { isCollapsed, setCollapsed } = useSidebar()
  // RTL: the sidebar sits on the RIGHT — the drawer slides from the right,
  // the border faces the content, and every chevron points the other way.
  const isRtl = useAppDir() === "rtl"
  // Self-serve purchase off (a prepaid instance): the Pricing/Billing entries
  // are withheld (and the credit card is a plain readout — sidebar-credit-card).
  const selfServe = surfaceBillingSelfServe()
  const sharedHeader = useSharedHeaderActive()
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
        <div aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex flex-col border-e transition-all duration-300 ease-in-out md:static",
          // Theme-aware background
          "bg-white dark:bg-zinc-950",
          // Theme-aware border
          "border-zinc-200 dark:border-zinc-800",
          isCollapsed ? "w-14" : "w-56",
          isMobileOpen
            ? "translate-x-0"
            : isRtl
              ? "translate-x-full md:translate-x-0"
              : "-translate-x-full md:translate-x-0",
          className,
        )}
      >
        {/* Under the shared site header the logo, the credit card, the user
            row and the language/theme switches are the header's (one gate:
            lib/shared-header.ts); otherwise this is the sidebar as it was. */}
        {sharedHeader ? (
          <SidebarHeaderModeStrip isCollapsed={isCollapsed} onMobileClose={onMobileClose} />
        ) : (
          <SidebarBrandStrip isCollapsed={isCollapsed} onMobileClose={onMobileClose} />
        )}

        {/* Credit card (sidebar-credit-card.tsx). */}
        {!sharedHeader && <SidebarCreditCard isCollapsed={isCollapsed} isRtl={isRtl} />}

        {/* Navigation */}
        {/* min-h-0 is what lets this actually shrink — a flex item defaults to
            min-height:auto and refuses to go below its content, which is what
            pushed the squeeze onto the credit card above. With it, the nav is
            the region that scrolls when the sidebar runs out of room. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-3 flex flex-col gap-1">
          {isCollapsed ? (
            // Collapsed: flat icon list, no labels
            NAV_ITEMS.map((item) => {
              if (item.hidden) return null
              if (isNavItemSurfaceHidden(item)) return null
              if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return null
              if (item.billingOnly && (!isFeatureEnabled("billing") || !selfServe)) return null
              if (item.prepaidOnly && (!isFeatureEnabled("billing") || selfServe)) return null
              if (item.multiUserOnly && !isMultiUser()) return null
              if (item.payerOnly && !isPayer) return null

              const isActive = isNavItemActive(item)

              const showBadge = item.href === "/admin" && pendingReportsCount > 0

              return (
                <Tooltip key={item.href + (item.search ?? "")}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.href + (item.search ?? "")}
                      onClick={handleNavClick}
                      aria-label={t(item.label)}
                      className={cn(
                        "flex items-center justify-center w-full h-9 transition-all duration-200",
                        isActive
                          ? "rounded-[9px] bg-zinc-200 dark:bg-[#1b1b21] text-zinc-900 dark:text-white shadow-[inset_2px_0_0_#ff0073]"
                          : "rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                      )}
                    >
                      <span className="relative">
                        <item.icon className="h-4 w-4" strokeWidth={1.5} />
                        {showBadge && (
                          <span className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-red-500" />
                        )}
                      </span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side={isRtl ? "left" : "right"} className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700">
                    {t(item.label)}
                  </TooltipContent>
                </Tooltip>
              )
            })
          ) : (
            // Expanded: sections with labels
            NAV_SECTIONS.map((section) => {
              const visibleItems = section.items.filter((item) => {
                if (item.hidden) return false
                if (isNavItemSurfaceHidden(item)) return false
                if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return false
                if (item.billingOnly && (!isFeatureEnabled("billing") || !selfServe)) return false
                if (item.prepaidOnly && (!isFeatureEnabled("billing") || selfServe)) return false
                if (item.multiUserOnly && !isMultiUser()) return false
                if (item.payerOnly && !isPayer) return false
                return true
              })

              if (visibleItems.length === 0) return null

              return (
                <div key={section.label} className="mb-4">
                  <p className="px-3 mb-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">
                    {t(section.label)}
                  </p>
                  {visibleItems.map((item) => {
                    const isActive = isNavItemActive(item)

                    const showBadge = item.href === "/admin" && pendingReportsCount > 0

                    return (
                      <Link
                        key={item.href + (item.search ?? "")}
                        to={item.href + (item.search ?? "")}
                        onClick={handleNavClick}
                        aria-label={t(item.label)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 text-sm transition-all duration-200",
                          isActive
                            ? "rounded-[9px] font-semibold bg-zinc-200 dark:bg-[#1b1b21] text-zinc-900 dark:text-white shadow-[inset_2px_0_0_#ff0073]"
                            : "rounded-md font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-white",
                        )}
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        <span>{t(item.label)}</span>
                        {showBadge && (
                          <span className="ms-auto px-1.5 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full">
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
        <SidebarFooter isCollapsed={isCollapsed} isRtl={isRtl} onToggleCollapsed={toggleCollapsed} accountControls={!sharedHeader} />
      </aside>
    </TooltipProvider>
  )
}

// The pieces split out of this file, re-exported for their existing importers.
export { sidebarCreditFigures, type SidebarCreditFigures } from "./sidebar-credit-card"
export { MobileHeader } from "./mobile-header"

// Re-export width constants for backward compatibility
export { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH }
