import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { AccessibilityStatementLink } from "@/components/legal/accessibility-statement-link"
import { ComplaintsLink } from "@/components/legal/complaints-link"
import { buttonHiddenOn } from "@/components/accessibility/accessibility-menu"
import type { SiteHeaderSlotProps } from "@/components/layout/site-header-slot"
import { markSharedHeaderMounted } from "@/lib/shared-header"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { Menu } from "lucide-react"
import { NodaroShell, shellTranslator } from "virtual:site-header"
import { createClient as createNodaroClient } from "@nodaro/sdk/client"
import type { UserBalance } from "@nodaro/sdk/credits"
import { NODARO_CLIENT_OPTIONS } from "@/lib/nodaro-client"
import { createClient } from "@/lib/supabase"
import { useUiLanguage } from "@/hooks/use-ui-language"
import { useT } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { runtimeMediaOrigin } from "@/lib/runtime-config"
import {
  availableWorlds,
  isNodeUnavailable,
  surfaceAvailabilityFailed,
  surfaceAvailabilityLoaded,
  useSurfaceAvailability,
} from "@/lib/surface-availability"
import { runtimeSurfaceProfile } from "@/lib/surface-profile"
import {
  surfaceBillingSelfServe,
  surfaceBrandLogo,
  surfaceConfiguredBrandName,
  surfaceLocalePicker,
} from "@/lib/surface-selectors"
import { HEADER_QUERY_KEYS } from "./query-keys"
import { WHITE_LABEL_WORLD_PATHS } from "./site"
import {
  imageOriginsFor,
  openSitePage,
  unitTranslator,
  whiteLabelRoute,
  whiteLabelWorldMenus,
  whiteLabelWorlds,
  withHeaderBalance,
  type UnitWords,
} from "./white-label"
import type { SiteHeaderHandle, SiteHeaderLanguage, SiteHeaderTheme } from "./types"

/**
 * The header mount of a deployment whose surface profile says
 * `header: "white-label"` (Cloud; reached only through
 * `components/layout/site-header-slot.tsx`, inside `DashboardLayout`). The npm
 * header in its white-label mode: nothing of Nodaro's is drawn, and every link,
 * mark, name, world and word is the deployment's — see `white-label.ts`.
 * Nodaro's own deployments use the hosted header (`hosted-header.tsx`), which
 * has no white-label mode; this mount, and the package behind it, stay for the
 * deployments that do.
 *
 *   - worlds: the deployment's (its profile's allowlist and order, narrowed by
 *     the server's per-viewer answer once it lands), each at its address on
 *     this same site (`WHITE_LABEL_WORLD_PATHS`), never a build's origins;
 *     their menus open a page below a world (Video's Translate) only for a
 *     viewer that answer offers it to (after a read of it that failed, one the
 *     profile does not deny), and none while it is awaited
 *     (`whiteLabelWorldMenus`, `menuWithheld`);
 *   - its name and logo (`brand.productName`, `brand.logo`), and images only
 *     from this site, the logo's own host and its media host (`mediaOrigin`);
 *   - its billing (`billing.selfServe`), and the credit pill in its own unit,
 *     from the figures the server converted (`white-label.ts`,
 *     `headerBalance`), worded in the app's dictionaries;
 *   - its languages (`locale.offered`, through the app's own list of
 *     languages; `locale.picker`), and the header's cookies on this host alone;
 *   - links: home is the site's root, sign-in this app's own page, the account
 *     pages this app's routes (`accountPages="in-app"`); no Nodaro address, not
 *     even the accessibility statement (Nodaro's own,
 *     `lib/accessibility-statement.ts`);
 *   - it is the app itself: it claims the signup grant on its own boot path
 *     (`claimSignupGrant={false}`), and its welcome offer and consent ask are
 *     the header's dialog (the layout leaves the app's own popup out, so one
 *     refused create never opens two dialogs);
 *   - the phone header switches at the app's own layout switch (Tailwind
 *     `md`, 768 px); on editor pages it is one compact row, so the canvas keeps
 *     its height. Its leading button opens the sidebar drawer;
 *   - accessibility is the header's: its menu (corner button + Alt+A) renders
 *     here, and the app's own menu steps aside while this mount is on the page
 *     (`markSharedHeaderMounted`, read by `AccessibilityMenuRoot`). On a canvas
 *     page the button is off, as the app's own menu does there
 *     (`buttonHiddenOn`); Alt+A still opens it. Both menus keep the same shared
 *     choices (`lib/accessibility-preferences.ts`).
 */

/**
 * What is withheld from the viewer, as the world menus read it: the viewer's
 * availability answer once it is in; after a read of it that failed, the
 * deployment's own configuration (the static profile's deny list, known
 * without the read, which every other reader falls back to as well:
 * `isNodeUnavailable` before an answer); `null` while the answer is awaited,
 * when no page is named.
 */
function menuWithheld(): ((nodeType: string) => boolean) | null {
  return surfaceAvailabilityLoaded() || surfaceAvailabilityFailed() ? isNodeUnavailable : null
}

/** The app's own phone/desktop switch (Tailwind `md`). */
const PHONE_BREAKPOINT = 768
/** One item of the account menu's legal links, styled like the shell's own items. */
const ACCOUNT_MENU_LINK =
  "flex min-h-10 w-full items-center rounded-[9px] px-2.5 text-start text-[13px] font-semibold hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#ff0073] dark:hover:bg-white/5"

/**
 * The header takes the SDK's FULL client (`NodaroClient`, every resource),
 * while the app's own `nodaroClient` carries only the resources the app calls
 * (see `lib/nodaro-client.ts`). Built here, from the same options as the app
 * client (`NODARO_CLIENT_OPTIONS`), so the two cannot drift, and only this
 * lazily loaded module loads every SDK resource — not every module that
 * reaches `nodaro-client.ts`. Its balance as that header draws it
 * (`headerBalance`), in the language on screen when it is read.
 */
const whiteLabelSdk = withHeaderBalance(createNodaroClient(NODARO_CLIENT_OPTIONS), () => useLocaleStore.getState().locale)

export default function WhiteLabelHeader({ compact, onOpenMenu, onHeaderOverlay }: SiteHeaderSlotProps) {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const shell = useRef<SiteHeaderHandle>(null)
  const { resolvedTheme, setTheme } = useTheme()
  const { locale, rows, pick } = useUiLanguage()

  // Re-render when the viewer's worlds land (DashboardLayout fetches them).
  const availability = useSurfaceAvailability()
  // The pages below a world its menu opens: none while the viewer's answer is awaited, then those it offers.
  const worldMenus = useMemo(() => whiteLabelWorldMenus(menuWithheld()), [availability])
  // The balance the header itself keeps (its own key; never fetched from here): its unit names the pill's words.
  const { data: balance } = useQuery<UserBalance>({
    queryKey: HEADER_QUERY_KEYS.credits,
    queryFn: () => whiteLabelSdk.credits.balance(),
    enabled: false,
  })
  const unit = balance?.display?.unit
  // The unit's word was picked for the language on screen when the balance was
  // read. A language change reads it again, or the header says the last
  // language's word until its next poll; with one label for every language
  // there is nothing to re-word. The exact key: the model prices live under
  // the same prefix.
  const wordedLanguage = useRef(locale)
  const hasUnitWords = balance?.display?.unitLabels !== undefined
  useEffect(() => {
    if (wordedLanguage.current === locale) return
    wordedLanguage.current = locale
    if (hasUnitWords) void queryClient.invalidateQueries({ queryKey: HEADER_QUERY_KEYS.credits, exact: true })
  }, [locale, hasUnitWords, queryClient])
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
  const here = window.location.origin
  const urls = useMemo(() => ({ app: here, login: "/login", home: "/" }), [here])
  // Before paint: the header's menu replaces the app's in the same frame.
  useLayoutEffect(() => markSharedHeaderMounted(), [])
  const shellT = useMemo(() => shellTranslator(locale), [locale])
  const headerT = useMemo(() => unitTranslator(shellT, unitWords), [shellT, unitWords])

  const showLanguages = surfaceLocalePicker()
  const language = useMemo<SiteHeaderLanguage | undefined>(() => {
    if (!showLanguages) return undefined
    return {
      current: locale,
      options: rows.map(({ id, nativeName, shortCode, dir }) => ({ id, nativeName, shortCode, dir })),
      // Only a language the app offers: the id comes back from the header.
      onChange: (id) => {
        const row = rows.find((candidate) => candidate.id === id)
        if (row) pick(row.id)
      },
    }
  }, [locale, rows, pick, showLanguages])
  // next-themes knows the theme only after mount; until then the pill waits.
  const theme = useMemo<SiteHeaderTheme | undefined>(() => {
    if (!resolvedTheme) return undefined
    const value = resolvedTheme === "dark" ? "dark" : "light"
    return { value, onToggle: () => setTheme(value === "dark" ? "light" : "dark") }
  }, [resolvedTheme, setTheme])

  const onNavigate = useCallback(
    (href: string) => {
      // On a white-label site the other worlds (and the site's home) are other apps' pages on this same site.
      const route = whiteLabelRoute(href, window.location.origin)
      if (route) navigate(route)
      else openSitePage(href)
    },
    [navigate],
  )
  const onAccountPage = useCallback((path: string) => navigate(path), [navigate])
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
      sdk={whiteLabelSdk}
      supabase={createClient()}
      queryClient={queryClient}
      sourceApp="app"
      activeWorld="app"
      worldHrefs={WHITE_LABEL_WORLD_PATHS}
      onNavigate={onNavigate}
      urls={urls}
      homeUrl="/"
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
      whiteLabel
      worlds={whiteLabelWorlds(runtimeSurfaceProfile().worlds, availableWorlds())}
      worldMenus={worldMenus}
      {...(logo ? { logo: { src: logo, alt: name ?? "" } } : {})}
      {...(name ? { brandName: name } : {})}
      imageOrigins={imageOriginsFor(logo, runtimeMediaOrigin())}
      selfServe={surfaceBillingSelfServe()}
      cookieDomain={null}
    />
  )
}
