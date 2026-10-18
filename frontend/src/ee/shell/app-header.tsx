import { useCallback, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { Menu } from "lucide-react"
import { NodaroShell, shellTranslator } from "virtual:site-header"
import { nodaroClient } from "@/lib/nodaro-client"
import { createClient } from "@/lib/supabase"
import { useUiLanguage } from "@/hooks/use-ui-language"
import { useT } from "@/lib/i18n"
import { headerHomeUrl, readSiteEnv, worldHrefsFor } from "./site"
import type { SiteAccountPage, SiteHeaderHandle, SiteHeaderLanguage, SiteHeaderTheme } from "./types"

/**
 * The app's ONE mount of the shared Nodaro site header (Cloud, behind
 * `sharedHeaderActive()` — reached only through
 * `components/layout/site-header-slot.tsx`, inside `DashboardLayout`).
 *
 *   - It is the Nodaro app itself: its account pages (plans, billing,
 *     settings, usage) are its own routes (`accountPages="in-app"`), it claims
 *     the signup grant on its own boot path (`claimSignupGrant={false}`). The
 *     header's dialog owns the welcome offer and the consent ask (its
 *     once-per-account auto-open on); the layout leaves the app's own popup
 *     out, so one refused create never opens two dialogs.
 *   - The App tab is this page's own `/projects`; the other links come from
 *     the build (`site.ts`), else the header's own.
 *   - The phone header switches at the app's own layout switch (Tailwind
 *     `md`, 768 px); on editor pages it is one compact row, so the canvas keeps
 *     its height. Its leading button opens the sidebar drawer.
 *   - Language and theme are the app's: the header's pills read and change
 *     them, and its text comes from its own dictionaries for the app's locale.
 */

/** The app's own phone/desktop switch (Tailwind `md`). */
const PHONE_BREAKPOINT = 768
const SITE = readSiteEnv()

export interface AppHeaderProps {
  /** Editor pages: one phone row, so the canvas keeps its height. */
  readonly compact: boolean
  /** Opens the sidebar drawer (phone). */
  readonly onOpenMenu: () => void
  /** A header overlay opened: the app closes its drawer, so the two never stack. */
  readonly onHeaderOverlay: () => void
}

export default function AppHeader({ compact, onOpenMenu, onHeaderOverlay }: AppHeaderProps) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const shell = useRef<SiteHeaderHandle>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, rows, pick } = useUiLanguage()

  const here = window.location.origin
  const worldHrefs = useMemo(() => worldHrefsFor(here, SITE), [here])
  const urls = useMemo(() => ({ app: here, login: "/login" }), [here])
  const headerT = useMemo(() => shellTranslator(locale), [locale])

  const language = useMemo<SiteHeaderLanguage>(
    () => ({
      current: locale,
      options: rows.map(({ id, nativeName, shortCode, dir }) => ({ id, nativeName, shortCode, dir })),
      // Only a language the app offers: the id comes back from the header.
      onChange: (id) => {
        const row = rows.find((candidate) => candidate.id === id)
        if (row) pick(row.id)
      },
    }),
    [locale, rows, pick],
  )
  // next-themes knows the theme only after mount; until then the pill waits.
  const theme = useMemo<SiteHeaderTheme | undefined>(() => {
    if (!resolvedTheme) return undefined
    const value = resolvedTheme === "dark" ? "dark" : "light"
    return { value, onToggle: () => setTheme(value === "dark" ? "light" : "dark") }
  }, [resolvedTheme, setTheme])

  const onNavigate = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.origin)
      if (url.origin === window.location.origin) navigate(`${url.pathname}${url.search}${url.hash}`)
    },
    [navigate],
  )
  const onAccountPage = useCallback((path: string, _page: SiteAccountPage) => navigate(path), [navigate])
  const onSignOut = useCallback(() => navigate("/login"), [navigate])
  const onOverlayChange = useCallback(
    (open: string | null) => {
      if (open) onHeaderOverlay()
    },
    [onHeaderOverlay],
  )
  const openMenu = useCallback(() => {
    shell.current?.closeOverlays()
    onOpenMenu()
  }, [onOpenMenu])

  return (
    <NodaroShell
      ref={shell}
      sdk={nodaroClient}
      supabase={createClient()}
      queryClient={queryClient}
      sourceApp="app"
      activeWorld="app"
      worldHrefs={worldHrefs}
      onNavigate={onNavigate}
      urls={urls}
      homeUrl={headerHomeUrl(SITE)}
      locale={locale}
      t={headerT}
      language={language}
      theme={theme}
      phoneBreakpoint={PHONE_BREAKPOINT}
      phoneLayout={compact ? "compact" : "full"}
      leadingSlot={
        <button
          type="button"
          onClick={openMenu}
          aria-label={t("nav.openMenu")}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      }
      accountPages="in-app"
      onAccountPage={onAccountPage}
      claimSignupGrant={false}
      onSignOut={onSignOut}
      onOverlayChange={onOverlayChange}
    />
  )
}
