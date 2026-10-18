import { Suspense, lazy } from "react"
import { Building2, ExternalLink, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { hasOrganizations } from "@/lib/edition"
import { NodaroLogo } from "@/components/nodaro-logo"
import { otherNodaroApps } from "@/lib/nodaro-apps"
import { surfaceBrandName } from "@/lib/surface-selectors"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * The workspace switcher, lazily loaded and only on a build that has
 * organizations — the same shape `router.tsx` uses to reach its enterprise
 * pages, and the only way core code reaches ee UI without a static import.
 * On every other build the chunk is never requested and the menu is exactly
 * what it was.
 */
export const OrgSwitcherSection = hasOrganizations()
  ? lazy(() => import("@/ee/components/org/org-switcher-section").then((m) => ({ default: m.OrgSwitcherSection })))
  : null

/**
 * Under the shared site header the logo and its app menu live in the header,
 * so the sidebar's top strip keeps only what has no other home: the workspace
 * switcher (organizations builds) and, in the phone drawer, the close button.
 * With neither, it renders nothing on desktop.
 */
export function SidebarHeaderModeStrip({ isCollapsed, onMobileClose }: SidebarBrandStripProps) {
  const t = useT()
  const closeButton = !isCollapsed && (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("nav.closeSidebar")}
      className="h-8 w-8 p-0 md:hidden text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
      onClick={onMobileClose}
    >
      <X className="h-4 w-4" />
    </Button>
  )
  if (!OrgSwitcherSection) {
    return closeButton ? <div className="flex justify-end px-3 py-2 md:hidden">{closeButton}</div> : null
  }
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("org.switcherWorkspacesHeader")}
          title={t("org.switcherWorkspacesHeader")}
          className={cn(
            "flex items-center gap-2 rounded px-1 py-1 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isCollapsed && "justify-center w-full",
          )}
        >
          <Building2 className="size-4" aria-hidden="true" />
          {!isCollapsed && <span className="truncate">{t("org.switcherWorkspacesHeader")}</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <Suspense fallback={null}>
            <OrgSwitcherSection />
          </Suspense>
        </DropdownMenuContent>
      </DropdownMenu>
      {closeButton}
    </div>
  )
}

interface SidebarBrandStripProps {
  readonly isCollapsed: boolean
  readonly onMobileClose?: () => void
}

/**
 * The sidebar's top strip: the logo, opening the fleet quick-switch menu (and
 * the workspace switcher), plus the phone drawer's close button.
 */
export function SidebarBrandStrip({ isCollapsed, onMobileClose }: SidebarBrandStripProps) {
  const t = useT()
  const brandName = surfaceBrandName()
  const siblingApps = otherNodaroApps("flow")
  return (
    /* Logo strip. Collapsed: h-[41px] — MUST match the editor toolbar height
       (they sit side-by-side on the editor page, borders aligned). Expanded:
       taller brand strip, 40px lockup with even margins. */
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
          aria-label={brandName === "Nodaro" ? t("nav.openNodaroApp") : t("nav.openMenu")}
          title={brandName === "Nodaro" ? t("nav.nodaroApps") : brandName}
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
          <DropdownMenuLabel>{brandName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {siblingApps.map((surface) => (
            <DropdownMenuItem key={surface.url} asChild className="px-3">
              <a href={surface.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                <span className="flex flex-col">
                  <span>{surface.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {new URL(surface.url).host}
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
  )
}
