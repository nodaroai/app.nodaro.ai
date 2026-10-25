import type { SharedAccessibilityState } from "virtual:site-a11y"

/**
 * Writes the shared accessibility cookie (`nodaro_a11y`) for the App's OWN
 * menu, on the pages of a shared-header build where the header (and so its
 * menu) is not mounted: sign-in, shares, published apps, admin, a page whose
 * header failed. The header package reads and applies this cookie but does
 * not export its writer, so this is the App's copy of it, byte for byte:
 * the same value, the same attributes, the same Domain rule. The Domain rule
 * is load-bearing — a host-only cookie beside the header's `.nodaro.ai` one
 * would be a second `nodaro_a11y`, and readers take the first.
 *
 * `__tests__/a11y-cookie.test.ts` holds the copy to the package: what this
 * writes, the package's own reader reads back unchanged (run against the
 * pinned package by the shared-header contract job). Replace it with the
 * package's writer once the package exports one.
 *
 * No import of the package here, so the app's typecheck and tests run
 * without it; the resolver's adapter wires it beside the package's reader.
 */

export const ACCESSIBILITY_COOKIE = "nodaro_a11y"
const SHARED_COOKIE_DOMAIN = ".nodaro.ai"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** The toggles in the package's order, each with its one letter in the cookie. */
const LETTERS = [
  ["contrast", "c"],
  ["spacing", "s"],
  ["links", "l"],
  ["headings", "h"],
  ["readableFont", "f"],
  ["bigCursor", "u"],
  ["stopMotion", "m"],
] as const

/** `1.<scale>.<letters>.<hidden-until>` — the package's format. */
export function encodeAccessibilityCookie(state: SharedAccessibilityState): string {
  const letters = LETTERS.filter(([key]) => state.prefs[key]).map(([, letter]) => letter).join("")
  return `1.${state.prefs.textScale}.${letters || "-"}.${state.hiddenUntil ?? 0}`
}

/** `.nodaro.ai` on that domain and its subdomains; none (host-only) elsewhere. */
export function cookieDomainFor(hostname: string): string | undefined {
  const bare = SHARED_COOKIE_DOMAIN.slice(1)
  return hostname === bare || hostname.endsWith(SHARED_COOKIE_DOMAIN) ? SHARED_COOKIE_DOMAIN : undefined
}

/** The whole `document.cookie` assignment for `state` on a page at `location`. */
export function accessibilityCookie(
  state: SharedAccessibilityState,
  location: { readonly hostname: string; readonly protocol: string },
): string {
  const domain = cookieDomainFor(location.hostname)
  const attributes = [
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`,
    "SameSite=Lax",
    ...(location.protocol === "https:" ? ["Secure"] : []),
    ...(domain ? [`Domain=${domain}`] : []),
  ]
  return `${ACCESSIBILITY_COOKIE}=${encodeAccessibilityCookie(state)}; ${attributes.join("; ")}`
}

/** Keeps the choices for every product. The defaults are written too, never deleted (the package's rule). */
export function writeAccessibilityCookie(state: SharedAccessibilityState): void {
  if (typeof document === "undefined") return
  try {
    document.cookie = accessibilityCookie(state, window.location)
  } catch {
    // Cookies blocked: the choice still applies for this visit.
  }
}
