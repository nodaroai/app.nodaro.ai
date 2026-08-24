import { Suspense, lazy, useCallback, useEffect, useState } from "react"
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
  Clapperboard,
  GraduationCap,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useT, tx, type MessageKey } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isFeatureEnabled, hasCredits, isCloud, isMultiUser } from "@/lib/edition"
import { useUserCredits } from "@/ee/hooks/queries/use-credits-queries"
import { PRICING_TIERS } from "@/lib/pricing-data"
import { APP_VERSION } from "@/lib/version"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { UpdateDialog } from "@/components/layout/update-dialog"
import { NodaroLogo } from "@/components/nodaro-logo"
import { hasOrganizations } from "@/lib/edition"

/**
 * The workspace switcher, lazily loaded and only on a build that has
 * organizations — the same shape `router.tsx` uses to reach its enterprise
 * pages, and the only way core code reaches ee UI without a static import.
 * On every other build the chunk is never requested and the menu is exactly
 * what it was.
 */
const OrgSwitcherSection = hasOrganizations()
  ? lazy(() => import("@/ee/components/org/org-switcher-section").then((m) => ({ default: m.OrgSwitcherSection })))
  : null
import { otherNodaroApps } from "@/lib/nodaro-apps"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSidebar, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from "./sidebar-context"

/** The rest of the Nodaro family, one hop away — the canonical fleet order
 *  minus Flow (see `nodaro-apps.ts`). All open in NEW tabs: the logo must
 *  never navigate a mid-edit user away. */
const NODARO_SURFACES = otherNodaroApps("flow")

const STORAGE_KEY = "nodaro-sidebar-collapsed"

/** Mono stack for the credit block, from the designer's Pricing mock. */
const MONO_FONT = "'JetBrains Mono Variable','JetBrains Mono',monospace"

interface NavItem {
  readonly href: string
  readonly label: MessageKey
  readonly icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  readonly adminOnly?: boolean
  readonly billingOnly?: boolean
  readonly multiUserOnly?: boolean
  /** Query string for destinations that are a tab rather than a route, e.g.
   *  Tutorials lives at /projects?tab=tutorials. Also disambiguates the active
   *  state from the plain item on the same path. */
  readonly search?: string
  /** Kept in the list but not rendered. Hidden rather than deleted so turning
   *  one back on is a one-word change and the route itself still works for
   *  anyone holding a direct link. */
  readonly hidden?: boolean
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
      { href: "/projects", search: "?tab=tutorials", label: "nav.tutorials", icon: GraduationCap },
      { href: "/apps", label: "nav.miniapps", icon: Rocket, hidden: true },
      { href: "/templates", label: "nav.templates", icon: LayoutTemplate, hidden: true },
      { href: "/video-director", label: "nav.videoDirector", icon: Clapperboard, hidden: true },
      { href: "/explore", label: "nav.explore", icon: Compass, multiUserOnly: true },
    ]
  },
  {
    label: "nav.section.activity",
    items: [
      { href: "/executions", label: "nav.executions", icon: History },
      { href: "/my-files", label: "nav.myFiles", icon: Archive },
      { href: "/_gallery", label: "nav.gallery", icon: Images },
    ]
  },
  {
    label: "nav.section.account",
    items: [
      { href: "/integrations", label: "nav.integrations", icon: Plug },
      { href: "/pricing", label: "nav.pricing", icon: Sparkles, billingOnly: true },
      { href: "/billing", label: "nav.billing", icon: CreditCard, billingOnly: true },
      { href: "/settings", label: "nav.settings", icon: Settings },
      { href: "/admin", label: "nav.admin", icon: Shield, adminOnly: true },
      { href: "/admin/community-reports", label: "nav.communityReports", icon: Flag, adminOnly: true },
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
    if (hoursLeft >= 1) return tx(hoursLeft !== 1 ? "nav.renewal.hours" : "nav.renewal.hour", { n: hoursLeft })
    const minutesLeft = Math.floor(msLeft / (1000 * 60))
    if (minutesLeft >= 1) return tx(minutesLeft !== 1 ? "nav.renewal.minutes" : "nav.renewal.minute", { n: minutesLeft })
    return tx("nav.renewal.lessThanMinute")
  }
  if (daysLeft <= 14) return tx(daysLeft !== 1 ? "nav.renewal.days" : "nav.renewal.day", { n: daysLeft })
  return new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

interface AppSidebarProps {
  /** If true, sidebar starts collapsed but can still be expanded by user */
  readonly defaultCollapsed?: boolean
  readonly onMobileClose?: () => void
  readonly isMobileOpen?: boolean
  readonly className?: string
}

/**
 * One pool inside the sidebar credit card: label and amount on a line, a thin
 * bar under them, and the expiry note below.
 *
 * The label and the amount sit on the SAME line on purpose — that is what frees
 * the full card width for the note underneath, which is what was being clipped
 * when the two pools were side-by-side columns.
 */
function CreditRow({
  label,
  value,
  pct,
  fill,
  subline,
}: {
  readonly label: string
  readonly value: number
  readonly pct: number
  readonly fill: string
  readonly subline: string | null
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--blg-t2-label)", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--blg-t1)", fontVariantNumeric: "tabular-nums" }}>
          {value.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "var(--blg-track)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: 3, borderRadius: 2, background: fill }} />
      </div>
      {subline && <span style={{ fontSize: 11, color: "var(--blg-t3-head)" }}>{subline}</span>}
    </div>
  )
}

export function AppSidebar({
  defaultCollapsed = false,
  onMobileClose,
  isMobileOpen = false,
  className,
}: AppSidebarProps) {
  const t = useT()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()

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
  const { user, isAdmin, signOut } = useAuth()
  const { isCollapsed, setCollapsed } = useSidebar()
  // RTL: the sidebar sits on the RIGHT — the drawer slides from the right,
  // the border faces the content, and every chevron points the other way.
  const isRtl = useAppDir() === "rtl"
  const { data: creditBalance } = useUserCredits(user?.id)
  const [mounted, setMounted] = useState(false)
  const updateInfo = useUpdateCheck()
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  // The version label opens the release dialog on click — in EVERY edition.
  // It NEVER opens on its own — interrupting someone who just came to work
  // with a changelog they did not ask for is an annoyance, not a feature
  // (founder, 2026-08-20). A new release only lights the label.
  //
  // It used to be clickable on self-host only while an update was pending
  // (#869): run the newest release and the affordance vanished, so "what is
  // in the version I am running" had no answer in the UI — while /v1/version
  // had already fetched the notes. The gate was hasCredits(), which answers
  // "do we bill", never "should this install see its release notes" (the
  // #752 lesson). The mode is the install's real state instead:
  //   updateAvailable → "upgrade"   (self-host, behind: backup + commands)
  //   cloud           → "whats-new" (just shipped, already live)
  //   otherwise       → "current"   (self-host, on the newest release)
  const updateAvailable = Boolean(updateInfo?.updateAvailable)
  const dialogMode: "upgrade" | "whats-new" | "current" = updateAvailable
    ? "upgrade"
    : isCloud()
      ? "whats-new"
      : "current"
  // The label prefers the SERVER-resolved version: on cloud the frontend
  // build bakes no version (Railway passes none) and the baked fallback sat
  // at 1.23.0 beside "What's new in v1.27.0" (founder report 2026-08-19).
  // /v1/version resolves the deployed SHA to its release tag server-side.
  const displayVersion = updateInfo?.current?.replace(/^v/, "") || APP_VERSION
  const latestVersion = updateInfo?.latest?.version
  // Has this browser already SEEN this release's notes? Drives the quiet dot
  // next to the version label — never an auto-open. A browser whose very
  // first visit lands on a release starts "seen": a brand-new user has no
  // catching up to do. (A pending update shows its own red dot regardless.)
  const [whatsNewSeen, setWhatsNewSeen] = useState(true)
  useEffect(() => {
    if (!latestVersion) return
    const KEY = "nodaro-whatsnew-seen"
    try {
      const seen = localStorage.getItem(KEY)
      if (seen === null) {
        localStorage.setItem(KEY, latestVersion)
        return
      }
      setWhatsNewSeen(seen === latestVersion)
    } catch {
      // storage blocked — no dot; the label itself still opens the dialog
    }
  }, [latestVersion])
  const markWhatsNewSeen = useCallback(() => {
    if (!latestVersion) return
    try {
      localStorage.setItem("nodaro-whatsnew-seen", latestVersion)
    } catch {
      // storage blocked — the dot simply returns next load
    }
    setWhatsNewSeen(true)
  }, [latestVersion])
  // Clickable whenever a release is known; plain text only while the check
  // has not answered or is off (NODARO_UPDATE_CHECK=off — air-gapped installs).
  const showVersionIndicator = Boolean(updateInfo?.latest)
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
        {/* Logo strip. Collapsed: h-[41px] — MUST match the editor toolbar height
            (they sit side-by-side on the editor page, borders aligned). Expanded:
            taller brand strip, 40px lockup with even margins. */}
        <div
          className={cn(
            "flex items-center justify-between px-3 border-b border-zinc-200 dark:border-zinc-800",
            isCollapsed ? "h-[41px]" : "h-[68px]",
          )}
        >
          {/* The logo opens the fleet quick-switch menu (fleet pattern — see
              the client apps' AppShell mark). Home stays one click away via
              the Projects nav item right below, so no navigation is lost. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("nav.openNodaroApp")}
              title={t("nav.nodaroApps")}
              className={cn(
                "flex items-center gap-2 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
                isCollapsed ? "justify-center w-full" : "ms-1",
              )}
            >
              {isCollapsed ? (
                <NodaroLogo variant="icon" size="md" />
              ) : (
                <NodaroLogo size="lg" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuLabel>Nodaro</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {NODARO_SURFACES.map((surface) => (
                <DropdownMenuItem key={surface.id} asChild className="px-3">
                  <a href={surface.href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    <span className="flex flex-col">
                      <span>{surface.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {new URL(surface.href).host}
                      </span>
                    </span>
                  </a>
                </DropdownMenuItem>
              ))}
              {OrgSwitcherSection && (
                <Suspense fallback={null}>
                  <OrgSwitcherSection />
                </Suspense>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Mobile close button */}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("nav.closeSidebar")}
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
                    className="w-full flex flex-col items-center gap-1.5 hover:opacity-90 transition-opacity"
                    style={{
                      padding: "10px 6px",
                      borderRadius: 12,
                      border: "1px solid var(--blg-border-3)",
                      background: "var(--blg-card)",
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--blg-t1)" }}>
                      {creditBalance.total >= 1000
                        ? `${(creditBalance.total / 1000).toFixed(1).replace(/\.0$/, "")}K`
                        : creditBalance.total}
                    </span>
                    <span className="flex flex-col gap-[3px] w-full px-1">
                      <span
                        style={{
                          display: "block",
                          height: 4,
                          borderRadius: 99,
                          background: "var(--blg-pink)",
                          width: `${creditBalance.total > 0 ? Math.max(12, (creditBalance.subscription / creditBalance.total) * 100) : 12}%`,
                        }}
                      />
                      <span
                        style={{
                          display: "block",
                          height: 4,
                          borderRadius: 99,
                          background: "var(--blg-cyan)",
                          width: `${creditBalance.total > 0 ? Math.max(12, (creditBalance.topup / creditBalance.total) * 100) : 12}%`,
                        }}
                      />
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side={isRtl ? "left" : "right"}
                  className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                >
                  <p>{t("nav.creditsLeft", { n: creditBalance.total })}</p>
                  {creditBalance.effectiveTier === "free" ? (
                    creditBalance.dailyLimit != null && (
                      <p className="text-zinc-500 dark:text-zinc-400">{t("nav.dailyLimitCreditsLeft", { n: Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent) })}</p>
                    )
                  ) : creditBalance.periodEnd && formatRenewalTime(creditBalance.periodEnd) ? (
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {t("nav.renewsAt", { time: formatRenewalTime(creditBalance.periodEnd) ?? "" })}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (() => {
            const tierName = PRICING_TIERS.find((t) => t.id === creditBalance.effectiveTier)?.name
            const planLabel = (tierName ?? creditBalance.effectiveTier).toUpperCase()
            const subPct = creditBalance.total > 0 ? (creditBalance.subscription / creditBalance.total) * 100 : 0
            const topupPct = creditBalance.total > 0 ? (creditBalance.topup / creditBalance.total) * 100 : 0
            const dailyLeft = creditBalance.dailyLimit != null
              ? Math.max(0, creditBalance.dailyLimit - creditBalance.dailySpent)
              : null
            const isDailyTier = creditBalance.effectiveTier === "free" || creditBalance.effectiveTier === "payg"
            const renewal = creditBalance.periodEnd ? formatRenewalTime(creditBalance.periodEnd) : null
            // "renews" is a PAID-tier fact only — free/payg credits are a
            // one-time signup grant, nothing refreshes (verified 2026-08-12).
            const subscriptionSubline = isDailyTier
              ? dailyLeft != null
                ? t("nav.dailyLeft", { n: dailyLeft })
                : t("nav.oneTimeGrant")
              : renewal
                ? t("nav.renewsLower", { time: renewal })
                : null

            // Credit block from the designer's Pricing mocks (2026-08-12):
            // gradient card themed via the --blg-* tokens in globals.css
            // (light values from the lite mock, dark = original constants).
            return (
              <div
                className="mx-2 mt-2 cursor-pointer text-left"
                style={{
                  border: "1px solid var(--blg-border-3)",
                  borderRadius: 14,
                  background: "var(--blg-card)",
                  overflow: "hidden",
                  // The sidebar is a flex column, so this card was a shrinkable
                  // item: when vertical space got tight it compressed and the
                  // `overflow: hidden` above silently cut the bottom row off —
                  // TOP-UP's bar and expiry note simply vanished. The nav below
                  // scrolls instead (see its min-h-0 + overflow-y-auto).
                  flexShrink: 0,
                }}
                onClick={() => navigate("/billing")}
              >
                <div style={{ padding: "14px 16px 14px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--blg-t2-dim)", fontWeight: 600 }}>
                      {t("nav.totalCredits")}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--blg-t3-dim)", fontFamily: MONO_FONT }}>
                      {planLabel}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 6 }}>
                    <span
                      style={{
                        fontSize: 32,
                        fontWeight: 700,
                        letterSpacing: "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--blg-t1)",
                      }}
                    >
                      {creditBalance.total.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--blg-t2-dim)" }}>{t("nav.credits")}</span>
                  </div>
                  {/* Two stacked rows, each with its own bar — replaces the
                      side-by-side columns from the first pass. Splitting the
                      sidebar's width in two left each subline ~70px and clipped
                      "renews Mar 8, 2027"; full-width rows give it the whole
                      card. Colours stay on the --blg-* tokens rather than the
                      mock's literals so both themes follow. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                    <CreditRow
                      label={t("nav.subscription")}
                      value={creditBalance.subscription}
                      pct={subPct}
                      fill="var(--blg-pink)"
                      subline={subscriptionSubline}
                    />
                    <CreditRow
                      label={t("nav.topup")}
                      value={creditBalance.topup}
                      pct={topupPct}
                      fill="var(--blg-cyan)"
                      subline={t("nav.validTwelveMonths")}
                    />
                  </div>
                </div>
              </div>
            )
          })()
        )}

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
              if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return null
              if (item.billingOnly && !isFeatureEnabled("billing")) return null
              if (item.multiUserOnly && !isMultiUser()) return null

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
                          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
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
                if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) return false
                if (item.billingOnly && !isFeatureEnabled("billing")) return false
                if (item.multiUserOnly && !isMultiUser()) return false
                return true
              })

              if (visibleItems.length === 0) return null

              return (
                <div key={section.label} className="mb-4">
                  <p className="px-3 mb-1 text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">
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
                      aria-label={t("nav.signOut")}
                      className="h-9 w-9 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                      onClick={signOut}
                    >
                      <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 text-xs font-medium">
                        {user.email?.[0]?.toUpperCase() || "U"}
                      </div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side={isRtl ? "left" : "right"}
                    className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                  >
                    <div className="text-xs">{user.email}</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{t("nav.clickToSignOut")}</div>
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
                        aria-label={t("nav.signOut")}
                        className="h-7 w-7 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 flex-shrink-0"
                        onClick={signOut}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side={isRtl ? "left" : "right"}
                      className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                    >
                      {t("nav.signOut")}
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
                      aria-label={t("nav.expandSidebar")}
                      className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                      onClick={toggleCollapsed}
                    >
                      {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side={isRtl ? "left" : "right"}
                    className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
                  >
                    {t("nav.expandSidebar")}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-2 px-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
                  onClick={toggleCollapsed}
                >
                  {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  <span className="text-sm">{t("nav.collapse")}</span>
                </Button>
              )}
            </div>
            {!isCollapsed && (
              <div className="flex items-center gap-0.5">
                <LanguageSwitcher />
                <ThemeToggle />
              </div>
            )}
          </div>

          {/* Version row. Clickable whenever a release is known, every
              edition. A RED dot when a newer release exists — action needed
              (self-host only: the endpoint owns the policy, updateAvailable
              is never true on cloud). Otherwise an unread release gets a
              quiet accent dot. Never a dialog that opens itself. */}
          <div className="text-center">
            {showVersionIndicator ? (
              <button
                type="button"
                onClick={() => {
                  markWhatsNewSeen()
                  setUpdateDialogOpen(true)
                }}
                className="group relative inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                title={
                  updateAvailable
                    ? t("nav.updateAvailable", { version: updateInfo?.latest?.version ?? "" })
                    : dialogMode === "current"
                      ? t("nav.whatsIn", { version: updateInfo?.latest?.version ?? "" })
                      : t("nav.whatsNewIn", { version: updateInfo?.latest?.version ?? "" })
                }
              >
                {(updateAvailable || !whatsNewSeen) && (
                  <span
                    aria-hidden
                    className={
                      updateAvailable
                        ? "absolute -left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500"
                        : "absolute -left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#ff0073]"
                    }
                  />
                )}
                <span className="underline decoration-dotted underline-offset-2">
                  {isCollapsed ? `v${displayVersion.split(".").slice(0, 2).join(".")}` : `v${displayVersion}`}
                </span>
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {isCollapsed ? `v${displayVersion.split(".").slice(0, 2).join(".")}` : `v${displayVersion}`}
              </span>
            )}
          </div>
          {updateInfo?.latest && showVersionIndicator && (
            <UpdateDialog
              open={updateDialogOpen}
              onOpenChange={setUpdateDialogOpen}
              info={updateInfo}
              mode={dialogMode}
            />
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
  const t = useT()
  const location = useLocation()
  const isDashboard = location.pathname === "/projects"
  const isRtl = useAppDir() === "rtl"

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 md:hidden">
      {!isDashboard && (
        <Link
          to="/projects"
          className="h-8 w-8 p-0 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 touch-manipulation"
          aria-label={t("nav.backToProjects")}
        >
          {isRtl ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Link>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("nav.openMenu")}
        className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <NodaroLogo size="sm" />
      <div className="ms-auto">
        <ThemeToggle />
      </div>
    </header>
  )
}

// Re-export width constants for backward compatibility
export { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH }
