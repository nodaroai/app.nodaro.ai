import { orderWorlds, worldAllowed, type SurfaceWorlds, type WorldId } from "@nodaro/shared/runtime-config"
import type { NodaroClient } from "@nodaro/sdk/client"
import type { UserBalance } from "@nodaro/sdk/credits"
import { spendableCredits } from "@/lib/spendable-credits"
import { WHITE_LABEL_WORLD_PATHS } from "./site"
import type { SiteHeaderLanguage, SiteHeaderTranslate, SiteWorldId } from "./types"

/**
 * The white-label header's pure parts (`app-header.tsx` mounts it): a
 * deployment of its own, whose surface profile says `header: "white-label"`.
 * The header then draws only what the app gives it, so each value here is the
 * deployment's, never Nodaro's.
 */

/**
 * The worlds the header draws, in order. The server's per-viewer answer
 * (`GET /v1/surface/availability` → `worlds`, already in the deployment's
 * order and narrowed to what the viewer may run) once it has landed; before
 * that, or from a server that sends none, the profile's `worlds` (its
 * allowlist, in its order). Either way only worlds with an address on the
 * site (`WHITE_LABEL_WORLD_PATHS`).
 */
export function whiteLabelWorlds(profile: SurfaceWorlds | undefined, offered: readonly WorldId[] | null): SiteWorldId[] {
  const worlds = offered ?? orderWorlds(profile?.order).filter((id) => worldAllowed(profile, id))
  return worlds.filter((id) => WHITE_LABEL_WORLD_PATHS[id] !== undefined)
}

/**
 * Where a link of the white-label header leads, as this app's router sees
 * it: the path of one of this app's own pages (the App world, `/projects`),
 * or null for a page another app serves on the same site (a world, the
 * site's home) — that one is a full page load (`openSitePage`), since this
 * app's router does not know it.
 */
export function whiteLabelRoute(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }
  const own = WHITE_LABEL_WORLD_PATHS.app as string
  if (url.origin !== origin || (url.pathname !== own && !url.pathname.startsWith(`${own}/`))) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** A full page load of another app's page on this site. */
export function openSitePage(href: string): void {
  window.location.assign(href)
}

/**
 * The https origins, beyond the page's own site, the header may draw images
 * from: the logo's, when it lives on another host. The runtime config names
 * no media host of the deployment's (TODO(nodaro): add one to the shared
 * contract if the header ever draws the deployment's own media), so anything
 * else the header would draw from another origin shows its stand-in instead.
 */
export function imageOriginsFor(logo: string | undefined): string[] {
  if (!logo || logo.startsWith("/")) return []
  try {
    const url = new URL(logo)
    return url.protocol === "https:" ? [url.origin] : []
  } catch {
    return []
  }
}

/**
 * The language pill narrowed to the languages the deployment offers
 * (`locale.offered`, compared without regard to letter case), keeping the
 * one on screen so the pill can say what it shows. Unchanged when the
 * deployment names none.
 */
export function offeredLanguage(language: SiteHeaderLanguage, offered: readonly string[] | undefined): SiteHeaderLanguage {
  if (!offered) return language
  const ids = new Set(offered.map((id) => id.toLowerCase()))
  const current = language.current.toLowerCase()
  return { ...language, options: language.options.filter(({ id }) => ids.has(id.toLowerCase()) || id.toLowerCase() === current) }
}

/** A figure the header shows; one the server could not give stays unknown (the header's "…"), never 0. */
function shown(figure: number | null | undefined): number {
  return (figure ?? undefined) as number
}

/**
 * The balance as the white-label header draws it. The header (0.15.0) shows
 * `total` on its credit pill and the account menu, and a meter of
 * `subscription` against `monthlyAllocation`, so the app hands it the figures
 * the sidebar card would show:
 *   - the headline the card picks (`spendableCredits`): the caller's
 *     allowance on a deployment with a single payer, an outside wallet's
 *     available figure where one funds the runs, the balance otherwise; the
 *     meter is what is left of the allowance, and an outside wallet has none;
 *   - in the deployment's own unit when the server converted the figures
 *     (`display`), else in credits. The app never converts: a figure the
 *     server did not convert is shown as it came.
 * A balance with none of these is handed over as it is.
 */
export function headerBalance(balance: UserBalance): UserBalance {
  // A display never refuses, so whether the deployment has a payer at all does not move it.
  const { allowance } = spendableCredits(balance, false)
  const external = balance.externalWallet
  const display = balance.display
  if (!display) {
    if (external) return { ...balance, total: shown(external.available), monthlyAllocation: 0 }
    if (allowance) return { ...balance, total: allowance.remaining, subscription: allowance.remaining, monthlyAllocation: allowance.granted }
    return balance
  }
  const welcome =
    balance.welcomeOffer && display.welcomeOffer
      ? { welcomeOffer: { ...balance.welcomeOffer, credits: shown(display.welcomeOffer.credits) } }
      : {}
  if (external) return { ...balance, ...welcome, total: shown(display.externalWallet?.available), monthlyAllocation: 0 }
  if (allowance) {
    return {
      ...balance,
      ...welcome,
      total: shown(display.allowance?.remaining),
      subscription: display.allowance?.remaining ?? 0,
      monthlyAllocation: display.allowance?.granted ?? 0,
    }
  }
  return {
    ...balance,
    ...welcome,
    total: shown(display.total),
    subscription: display.subscription ?? 0,
    monthlyAllocation: display.monthlyAllocation ?? 0,
  }
}

/**
 * The SDK client as the white-label header gets it: the same client, whose
 * `credits.balance()` answers `headerBalance` of the balance. Every other call
 * is the client's own (a resource's methods run on the resource itself).
 */
export function withHeaderBalance(sdk: NodaroClient): NodaroClient {
  const balance = async () => headerBalance(await sdk.credits.balance())
  const credits = new Proxy(sdk.credits, { get: (target, key) => (key === "balance" ? balance : Reflect.get(target, key)) })
  return new Proxy(sdk, { get: (target, key) => (key === "credits" ? credits : Reflect.get(target, key)) })
}

/** The header's words for its credit figures, in the deployment's own unit (from the app's dictionaries). */
export interface UnitWords {
  readonly label: string
  readonly balance: (credits: string) => string
  readonly pill: (credits: string) => string
  readonly loading: string
  readonly left: string
  readonly meter: (left: string, total: string) => string
}

/**
 * The header's translator with its credit words in the deployment's unit:
 * the keys whose sentences say "credits" (the pill, its screen-reader line,
 * the account menu's caption and meter) are worded with `words`; every other
 * key is the header's own. `null` (no unit: the figures are credits) is the
 * header's translator unchanged.
 */
export function unitTranslator(t: SiteHeaderTranslate, words: UnitWords | null): SiteHeaderTranslate {
  if (!words) return t
  const text = (value: string | number | undefined) => (value === undefined ? "" : String(value))
  return (key, vars) => {
    switch (key) {
      case "credits.label":
        return words.label
      case "credits.balance":
        return words.balance(text(vars?.credits))
      case "credits.pill":
        return words.pill(text(vars?.credits))
      case "credits.loading":
        return words.loading
      case "account.creditsLeft":
        return words.left
      case "account.monthMeter":
        return words.meter(text(vars?.left), text(vars?.total))
      default:
        return t(key, vars)
    }
  }
}
