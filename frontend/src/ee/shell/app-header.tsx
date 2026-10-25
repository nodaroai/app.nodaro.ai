import { useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { AccessibilityStatementLink } from "@/components/legal/accessibility-statement-link"
import { buttonHiddenOn } from "@/components/accessibility/accessibility-menu"
import { ACCESSIBILITY_STATEMENT_PATH } from "@/lib/accessibility-statement"
import { markSharedHeaderMounted } from "@/lib/shared-header"
import { useLocation, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { Menu } from "lucide-react"
import { NodaroShell, shellTranslator } from "virtual:site-header"
import { createClient as createNodaroClient } from "@nodaro/sdk/client"
import { NODARO_CLIENT_OPTIONS } from "@/lib/nodaro-client"
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
 *     The language is also every product's (`lib/locale-store.ts`).
 *   - Accessibility is the header's: its menu (corner button + Alt+A) renders
 *     here, and the app's own menu steps aside while this mount is on the page
 *     (`markSharedHeaderMounted`, read by `AccessibilityMenuRoot`). On a canvas
 *     page the button is off (`accessibilityButton={false}`), as the app's own
 *     menu does there (`buttonHiddenOn`); Alt+A still opens it. Its statement
 *     link is the app's statement route, so there is one statement. Both menus
 *     keep the same shared choices (`lib/accessibility-preferences.ts`).
 */

/** The app's own phone/desktop switch (Tailwind `md`). */
const PHONE_BREAKPOINT = 768
const SITE = readSiteEnv()

/**
 * The header takes the SDK's FULL client (`NodaroClient`, every resource),
 * while the app's own `nodaroClient` carries only the resources the app calls
 * (see `lib/nodaro-client.ts`). Built here, from the same options as the app
 * client (`NODARO_CLIENT_OPTIONS`), so the two cannot drift, and only this
 * lazily loaded module loads every SDK resource — not
 * every module that reaches `nodaro-client.ts`.
 */
const headerSdk = createNodaroClient(NODARO_CLIENT_OPTIONS)

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
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const shell = useRef<SiteHeaderHandle>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, rows, pick } = useUiLanguage()

  const here = window.location.origin
  const worldHrefs = useMemo(() => worldHrefsFor(here, SITE), [here])
  const urls = useMemo(
    () => ({ app: here, login: "/login", accessibility: `${here}${ACCESSIBILITY_STATEMENT_PATH}` }),
    [here],
  )
  // Before paint: the header's menu replaces the app's in the same frame.
  useLayoutEffect(() => markSharedHeaderMounted(), [])
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
      sdk={headerSdk}
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
      accountMenuExtras={({ close }) => (
        <AccessibilityStatementLink
          role="menuitem"
          onClick={close}
          className="flex min-h-10 w-full items-center rounded-[9px] px-2.5 text-start text-[13px] font-semibold hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#ff0073] dark:hover:bg-white/5"
        />
      )}
      accessibilityButton={!buttonHiddenOn(pathname)}
      claimSignupGrant={false}
      onSignOut={onSignOut}
      onOverlayChange={onOverlayChange}
    />
  )
}
