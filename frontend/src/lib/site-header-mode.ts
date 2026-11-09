import { hasSharedHeader, hasWhiteLabelHeader } from "@/lib/edition"
import {
  surfaceBillingSelfServe,
  surfaceConfiguredBrandName,
  surfaceHeaderMode,
  surfacePlatformLinks,
  surfaceSidebarCreditCardHidden,
} from "@/lib/surface-selectors"

/**
 * Which shared site header this DEPLOYMENT shows, if any — decided at run time
 * from the build and the deployment's surface profile, before any reason of
 * one page's own (`lib/shared-header.ts` adds those: an embedded page, a
 * header that failed):
 *
 *   - `"white-label"` where the surface profile says `header: "white-label"`,
 *     on a build that carries the header (`hasWhiteLabelHeader()`): the
 *     deployment's own header, with nothing of Nodaro's in it;
 *   - `"default"`, Nodaro's header, on a build that may show it
 *     (`hasSharedHeader()`: staging) and a deployment that is Nodaro's own — no
 *     brand name of its own, Nodaro's platform links shown, self-serve billing,
 *     the credit figure not hidden;
 *   - `null` otherwise: the app's own chrome, as on a build without the header.
 *
 * The header's language and accessibility stores and stylesheet follow this
 * (`lib/locale-store.ts`, `components/i18n-html-dir.tsx`,
 * `lib/accessibility-preferences.ts`), not the build: the image built for
 * deployments of their own carries the header, and a deployment that does not
 * ask for it must read and write nothing of the header's.
 *
 * Imports only the build flags and the surface selectors: the locale store
 * reads it while the app's modules are still loading.
 */
export type SiteHeaderMode = "default" | "white-label"

export function siteHeaderMode(): SiteHeaderMode | null {
  // A build without the header answers before anything is asked: Vite inlines
  // the flag, so on every such build (self-host, production until the
  // cut-over) this function is a constant null.
  const built = import.meta.env.VITE_SHARED_HEADER === "true" || import.meta.env.VITE_SHARED_HEADER === "white-label"
  if (!built) return null
  if (surfaceHeaderMode() === "white-label") return hasWhiteLabelHeader() ? "white-label" : null
  if (!hasSharedHeader()) return null
  const nodaroOwn =
    surfaceConfiguredBrandName() === undefined &&
    surfacePlatformLinks() &&
    surfaceBillingSelfServe() &&
    !surfaceSidebarCreditCardHidden()
  return nodaroOwn ? "default" : null
}

/** The header's cookie options (language, accessibility): kept on this host on a white-label deployment. */
export interface SiteHeaderCookieOptions {
  readonly cookieDomain?: null
}

/**
 * Where the header and the app keep the header's cookies. A white-label
 * deployment keeps them on its own host (`cookieDomain: null`); anywhere else
 * the header's own rule holds (the products' common domain on Nodaro's sites).
 * The header and every call of the app's that writes one take the same value,
 * so two cookies of one name can never both exist.
 */
export function siteHeaderCookieOptions(): SiteHeaderCookieOptions {
  return siteHeaderMode() === "white-label" ? { cookieDomain: null } : {}
}
