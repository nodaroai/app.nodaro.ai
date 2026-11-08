import { useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { AccessibilityStatementLink } from "@/components/legal/accessibility-statement-link"
import { ComplaintsLink } from "@/components/legal/complaints-link"
import { buttonHiddenOn } from "@/components/accessibility/accessibility-menu"
import { ACCESSIBILITY_STATEMENT_PATH } from "@/lib/accessibility-statement"
import { markSharedHeaderMounted } from "@/lib/shared-header"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { Menu } from "lucide-react"
import { NodaroShell, shellTranslator } from "virtual:site-header"
import { createClient as createNodaroClient, type NodaroClient } from "@nodaro/sdk/client"
import type { UserBalance } from "@nodaro/sdk/credits"
import { NODARO_CLIENT_OPTIONS } from "@/lib/nodaro-client"
import { createClient } from "@/lib/supabase"
import { useUiLanguage } from "@/hooks/use-ui-language"
import { useT } from "@/lib/i18n"
import { runtimeMediaOrigin } from "@/lib/runtime-config"
import { siteHeaderMode } from "@/lib/site-header-mode"
import { availableWorlds, useSurfaceAvailability } from "@/lib/surface-availability"
import { runtimeSurfaceProfile } from "@/lib/surface-profile"
import {
  surfaceBillingSelfServe,
  surfaceBrandLogo,
  surfaceConfiguredBrandName,
  surfaceLocaleOffered,
  surfaceLocalePicker,
} from "@/lib/surface-selectors"
import { HEADER_QUERY_KEYS } from "./query-keys"
import { WHITE_LABEL_WORLD_PATHS, headerHomeUrl, readSiteEnv, worldHrefsFor } from "./site"
import {
  imageOriginsFor,
  offeredLanguage,
  openSitePage,
  unitTranslator,
  whiteLabelRoute,
  whiteLabelWorlds,
  withHeaderBalance,
  type UnitWords,
} from "./white-label"
import type { SiteAccountPage, SiteHeaderHandle, SiteHeaderLanguage, SiteHeaderProps, SiteHeaderTheme } from "./types"

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
 *
 * On a deployment whose surface profile says `header: "white-label"`
 * (`siteHeaderMode()`), the same mount in the header's white-label mode
 * (`WhiteLabelHeader` below): nothing of Nodaro's is drawn, and every link,
 * mark, name, world and word is the deployment's — see `white-label.ts`.
 */

/** The app's own phone/desktop switch (Tailwind `md`). */
const PHONE_BREAKPOINT = 768
/** This build's origins, each read by name (Vite inlines them; the Dockerfile sync test finds them so). */
const SITE = readSiteEnv({
  VITE_HOME_URL: import.meta.env.VITE_HOME_URL,
  VITE_TOOLS_URL: import.meta.env.VITE_TOOLS_URL,
  VITE_STUDIO_URL: import.meta.env.VITE_STUDIO_URL,
})
/** One item of the account menu's legal links, styled like the shell's own items. */
const ACCOUNT_MENU_LINK =
  "flex min-h-10 w-full items-center rounded-[9px] px-2.5 text-start text-[13px] font-semibold hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#ff0073] dark:hover:bg-white/5"

/**
 * The header takes the SDK's FULL client (`NodaroClient`, every resource),
 * while the app's own `nodaroClient` carries only the resources the app calls
 * (see `lib/nodaro-client.ts`). Built here, from the same options as the app
 * client (`NODARO_CLIENT_OPTIONS`), so the two cannot drift, and only this
 * lazily loaded module loads every SDK resource — not
 * every module that reaches `nodaro-client.ts`.
 */
const headerSdk = createNodaroClient(NODARO_CLIENT_OPTIONS)
/** The same client for the white-label header: its balance as that header draws it (`headerBalance`). */
const whiteLabelSdk = withHeaderBalance(headerSdk)

export interface AppHeaderProps {
  /** Editor pages: one phone row, so the canvas keeps its height. */
  readonly compact: boolean
  /** Opens the sidebar drawer (phone). */
  readonly onOpenMenu: () => void
  /** A header overlay opened: the app closes its drawer, so the two never stack. */
  readonly onHeaderOverlay: () => void
}

export default function AppHeader(props: AppHeaderProps) {
  return siteHeaderMode() === "white-label" ? <WhiteLabelHeader {...props} /> : <SiteHeader {...props} />
}

/**
 * What a white-label deployment's header takes over from the default mount:
 * its client, links, words and language, and the white-label props.
 */
interface WhiteLabelWiring {
  readonly sdk: NodaroClient
  readonly props: Pick<SiteHeaderProps, "whiteLabel" | "worlds" | "logo" | "brandName" | "imageOrigins" | "selfServe" | "cookieDomain">
  /** The header's credit words in the deployment's unit; null while the figures are credits. */
  readonly unitWords: UnitWords | null
  /** The languages the deployment offers (undefined: every one); false: no language pill. */
  readonly languages: readonly string[] | undefined | false
}

/**
 * A white-label deployment's header (`header: "white-label"`):
 *   - worlds: the deployment's (its profile's allowlist and order, narrowed by
 *     the server's per-viewer answer once it lands), each at its address on
 *     this same site (`WHITE_LABEL_WORLD_PATHS`), never a build's origins;
 *   - its name and logo (`brand.productName`, `brand.logo`), and images only
 *     from this site, the logo's own host and its media host (`mediaOrigin`);
 *   - its billing (`billing.selfServe`), and the credit pill in its own unit,
 *     from the figures the server converted (`white-label.ts`,
 *     `headerBalance`), worded in the app's dictionaries;
 *   - its languages (`locale.offered`, `locale.picker`), and the header's
 *     cookies on this host alone;
 *   - links: home is the site's root, sign-in this app's own page, the account
 *     pages this app's routes; no Nodaro address, not even the accessibility
 *     statement (Nodaro's own, `lib/accessibility-statement.ts`).
 */
function WhiteLabelHeader(props: AppHeaderProps) {
  const t = useT()
  // Re-render when the viewer's worlds land (DashboardLayout fetches them).
  useSurfaceAvailability()
  // The balance the header itself keeps (its own key; never fetched from here): its unit names the pill's words.
  const { data: balance } = useQuery<UserBalance>({
    queryKey: HEADER_QUERY_KEYS.credits,
    queryFn: () => whiteLabelSdk.credits.balance(),
    enabled: false,
  })
  const unit = balance?.display?.unit
  const unitWords = useMemo<UnitWords | null>(
    () =>
      unit
        ? {
            label: unit,
            balance: (credits) => t("header.units.balance", { credits, unit }),
            pill: (credits) => t("header.units.pill", { credits, unit }),
            loading: t("header.units.loading", { unit }),
            left: t("header.units.left", { unit }),
            meter: (left, total) => t("header.units.meter", { left, total, unit }),
          }
        : null,
    [t, unit],
  )
  const logo = surfaceBrandLogo()
  const name = surfaceConfiguredBrandName()
  const wiring: WhiteLabelWiring = {
    sdk: whiteLabelSdk,
    props: {
      whiteLabel: true,
      worlds: whiteLabelWorlds(runtimeSurfaceProfile().worlds, availableWorlds()),
      ...(logo ? { logo: { src: logo, alt: name ?? "" } } : {}),
      ...(name ? { brandName: name } : {}),
      imageOrigins: imageOriginsFor(logo, runtimeMediaOrigin()),
      selfServe: surfaceBillingSelfServe(),
      cookieDomain: null,
    },
    unitWords,
    languages: surfaceLocalePicker() ? surfaceLocaleOffered() : false,
  }
  return <SiteHeader {...props} whiteLabel={wiring} />
}

function SiteHeader({ compact, onOpenMenu, onHeaderOverlay, whiteLabel }: AppHeaderProps & { readonly whiteLabel?: WhiteLabelWiring }) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const shell = useRef<SiteHeaderHandle>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, rows, pick } = useUiLanguage()

  const here = window.location.origin
  const white = whiteLabel !== undefined
  const worldHrefs = useMemo(() => (white ? WHITE_LABEL_WORLD_PATHS : worldHrefsFor(here, SITE)), [here, white])
  const urls = useMemo(
    () =>
      white
        ? { app: here, login: "/login", home: "/" }
        : { app: here, login: "/login", accessibility: `${here}${ACCESSIBILITY_STATEMENT_PATH}` },
    [here, white],
  )
  // Before paint: the header's menu replaces the app's in the same frame.
  useLayoutEffect(() => markSharedHeaderMounted(), [])
  const shellT = useMemo(() => shellTranslator(locale), [locale])
  const unitWords = whiteLabel?.unitWords ?? null
  const headerT = useMemo(() => unitTranslator(shellT, unitWords), [shellT, unitWords])

  const languages = whiteLabel?.languages
  const language = useMemo<SiteHeaderLanguage | undefined>(() => {
    if (languages === false) return undefined
    const all: SiteHeaderLanguage = {
      current: locale,
      options: rows.map(({ id, nativeName, shortCode, dir }) => ({ id, nativeName, shortCode, dir })),
      // Only a language the app offers: the id comes back from the header.
      onChange: (id) => {
        const row = rows.find((candidate) => candidate.id === id)
        if (row) pick(row.id)
      },
    }
    return offeredLanguage(all, languages)
  }, [locale, rows, pick, languages])
  // next-themes knows the theme only after mount; until then the pill waits.
  const theme = useMemo<SiteHeaderTheme | undefined>(() => {
    if (!resolvedTheme) return undefined
    const value = resolvedTheme === "dark" ? "dark" : "light"
    return { value, onToggle: () => setTheme(value === "dark" ? "light" : "dark") }
  }, [resolvedTheme, setTheme])

  const onNavigate = useCallback(
    (href: string) => {
      if (white) {
        // On a white-label site the other worlds (and the site's home) are other apps' pages on this same site.
        const route = whiteLabelRoute(href, window.location.origin)
        if (route) navigate(route)
        else openSitePage(href)
        return
      }
      const url = new URL(href, window.location.origin)
      if (url.origin === window.location.origin) navigate(`${url.pathname}${url.search}${url.hash}`)
    },
    [navigate, white],
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
      sdk={whiteLabel?.sdk ?? headerSdk}
      supabase={createClient()}
      queryClient={queryClient}
      sourceApp="app"
      activeWorld="app"
      worldHrefs={worldHrefs}
      onNavigate={onNavigate}
      urls={urls}
      homeUrl={white ? "/" : headerHomeUrl(SITE)}
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
        <>
          <AccessibilityStatementLink role="menuitem" onClick={close} className={ACCOUNT_MENU_LINK} />
          <ComplaintsLink role="menuitem" onClick={close} className={ACCOUNT_MENU_LINK} />
        </>
      )}
      accessibilityButton={!buttonHiddenOn(pathname)}
      claimSignupGrant={false}
      onSignOut={onSignOut}
      onOverlayChange={onOverlayChange}
      {...whiteLabel?.props}
    />
  )
}
