import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useT } from "@/lib/i18n"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isCloud } from "@/lib/edition"
import { APP_VERSION } from "@/lib/version"
import { useUpdateCheck } from "@/hooks/use-update-check"
import { UpdateDialog } from "@/components/layout/update-dialog"
import { surfacePlatformLinks } from "@/lib/surface-selectors"
import { AccessibilityStatementLink } from "@/components/legal/accessibility-statement-link"

interface SidebarFooterProps {
  readonly isCollapsed: boolean
  readonly isRtl: boolean
  readonly onToggleCollapsed: () => void
  /**
   * The signed-in user with sign-out, and the language and theme switches.
   * Default true; false under the shared site header, which carries them.
   */
  readonly accountControls?: boolean
}

/**
 * The sidebar's bottom section: the signed-in user with sign-out, the collapse
 * toggle, the language and theme switches, and the version row with its
 * release dialog.
 */
export function SidebarFooter({ isCollapsed, isRtl, onToggleCollapsed, accountControls = true }: SidebarFooterProps) {
  const t = useT()
  const { user, signOut } = useAuth()
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
  const showVersionIndicator = surfacePlatformLinks() && Boolean(updateInfo?.latest)

  return (
    <div className="px-2 py-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
      {/* User info */}
      {accountControls && user && (
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
                  onClick={onToggleCollapsed}
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
              onClick={onToggleCollapsed}
            >
              {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              <span className="text-sm">{t("nav.collapse")}</span>
            </Button>
          )}
        </div>
        {accountControls && !isCollapsed && (
          <div className="flex items-center gap-0.5">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        )}
      </div>

      {/* The accessibility statement (Cloud only; renders nothing elsewhere). */}
      {!isCollapsed && (
        <div className="text-center">
          <AccessibilityStatementLink className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" />
        </div>
      )}

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
                    ? "absolute -start-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500"
                    : "absolute -start-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#ff0073]"
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
  )
}
