import { surfaceUnitLabel, type WorldId } from "@nodaro/shared/runtime-config"
import type { NodaroClient } from "@nodaro/sdk/client"
import type { UserBalance } from "@nodaro/sdk/credits"
import { spendableCredits, spendableDisplayFigure } from "@/lib/spendable-credits"
import { WHITE_LABEL_WORLD_PATHS } from "./site"
import type { SiteHeaderTranslate, SiteWorldId, SiteWorldMenu, SiteWorldMenuPage } from "./types"

/**
 * The white-label header's pure parts (`white-label-header.tsx` mounts it): a
 * deployment of its own, whose surface profile says `header: "white-label"`.
 * The header then draws only what the app gives it, so each value here is the
 * deployment's, never Nodaro's.
 */

/**
 * The worlds the header draws, in order: the worlds offered to the viewer
 * (`offeredWorlds`: the server's per-viewer answer once it has landed, already
 * in the deployment's order and narrowed to what the viewer may run; before
 * that, the deployment's own `worlds` and node lists), those with an address
 * on the site (`WHITE_LABEL_WORLD_PATHS`).
 */
export function whiteLabelWorlds(offered: readonly WorldId[]): SiteWorldId[] {
  return offered.filter((id) => WHITE_LABEL_WORLD_PATHS[id] !== undefined)
}

/**
 * The pages below a world that the white-label header's world menu may open
 * (the package's `WORLD_MENU_PAGES`, @nodaroai/shell ≥ 0.24.7), with the node
 * types each one runs. Each is a page of the worlds app on this same site,
 * below the world's address (`WHITE_LABEL_WORLD_PATHS`): Translate is
 * `/video/translate`, the worlds app's Translate mode, which runs `dubbing`
 * and which that app shows a viewer exactly when the platform withholds none
 * of these node types from them. A white-label header draws such a page only
 * where the host names it, so this app names it by the same rule once the
 * viewer's answer is in, and both headers on the site (and the worlds app's
 * tabs) agree. Before that answer, and after a read of it that failed, a
 * deployment that set node lists is judged by them: no Translate where they
 * withhold `dubbing` (outside `nodes.allow`, or in `nodes.deny`).
 *
 * Every page the package lists for a world this header draws is decided:
 * here, or never named (`WHITE_LABEL_MENU_PAGES_NEVER_NAMED`, with why), and
 * never both (`white-label-menus-package.test.tsx` fails a page that is
 * undecided); a world with none, or one this header does not draw (Speech), is
 * left out.
 */
export const WHITE_LABEL_MENU_PAGES: Readonly<Partial<Record<SiteWorldId, Readonly<Partial<Record<SiteWorldMenuPage, readonly string[]>>>>>> =
  Object.freeze({
    video: Object.freeze({ translate: Object.freeze(["dubbing"]) }),
  })

/**
 * The pages below a world (the package's `WORLD_MENU_PAGES`) that the
 * white-label header never names, whatever the viewer is offered, so it never
 * draws them:
 *
 *   - Video's Editor (`/video/editor`, @nodaroai/shell ≥ 0.31): Nodaro's own
 *     video editor, which the worlds app offers only on Nodaro's sites, never
 *     on a deployment of its own, so no white-label site serves that page (and
 *     the menu's text about it names Nodaro).
 */
export const WHITE_LABEL_MENU_PAGES_NEVER_NAMED: Readonly<Partial<Record<SiteWorldId, readonly string[]>>> = Object.freeze({
  video: Object.freeze(["editor"]),
})

/**
 * The white-label header's `worldMenus`: for each world above, the pages the
 * viewer is offered, those none of whose node types `unavailable` names (the
 * server's per-viewer answer, `GET /v1/surface/availability` → `nodes.denied`;
 * before it, or after a read that failed, the deployment's own node lists:
 * `settledNodeJudge`). `null` (the answer awaited on a deployment that sets no
 * node lists) names none, so a page the answer may withhold is not drawn and
 * then taken away. Where node lists are set they decide from the first paint:
 * a page they withhold is never drawn, and one an admin switched off shows
 * until the answer arrives.
 */
export function whiteLabelWorldMenus(unavailable: ((nodeType: string) => boolean) | null): Partial<Record<SiteWorldId, SiteWorldMenu>> {
  const menus: Partial<Record<SiteWorldId, SiteWorldMenu>> = {}
  for (const [world, pages] of Object.entries(WHITE_LABEL_MENU_PAGES) as [SiteWorldId, Partial<Record<SiteWorldMenuPage, readonly string[]>>][]) {
    const offered = unavailable
      ? (Object.entries(pages) as [SiteWorldMenuPage, readonly string[]][])
          .filter(([, nodes]) => !nodes.some(unavailable))
          .map(([page]) => page)
      : []
    menus[world] = { pages: offered }
  }
  return menus
}

/**
 * The worlds to come that the header marks "Soon": the profile's `worlds.soon`
 * with an address on the site (`WHITE_LABEL_WORLD_PATHS`), in the profile's
 * order. Such a world is never offered, so it is never among `whiteLabelWorlds`.
 */
export function whiteLabelSoonWorlds(soon: readonly WorldId[] | undefined): SiteWorldId[] {
  return (soon ?? []).filter((id) => WHITE_LABEL_WORLD_PATHS[id] !== undefined)
}

/** The profile's `toolApps`, as this header reads it. */
export interface WhiteLabelToolApps {
  readonly menus: boolean
  readonly pictures?: Readonly<Record<string, string>>
  readonly apps?: readonly string[]
}

/** The header's props for the tools app's mini apps. */
export interface WhiteLabelAppsMenus {
  readonly appsMenus?: true
  readonly offeredApps?: readonly string[]
  readonly appPictures?: Readonly<Record<string, string>>
}

/**
 * The apps-first menus, where the deployment asks for them (`toolApps.menus`),
 * so this header and the worlds app's own agree on the site. The apps it
 * lists are the ones the deployment names (`toolApps.apps`): this app does not
 * know which node types a mini app runs, so with no list it draws no app (the
 * header's rule for a white-label host). Its own pictures ride along
 * (`toolApps.pictures`). Nothing where the deployment does not ask.
 */
export function whiteLabelAppsMenus(toolApps: WhiteLabelToolApps | undefined): WhiteLabelAppsMenus {
  if (toolApps?.menus !== true) return {}
  const pictures = toolApps.pictures ?? {}
  return {
    appsMenus: true,
    offeredApps: toolApps.apps ?? [],
    ...(Object.keys(pictures).length > 0 ? { appPictures: pictures } : {}),
  }
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

/** The logo's https origin, when it lives on another host. */
function logoOrigin(logo: string | undefined): string | undefined {
  if (!logo || logo.startsWith("/")) return undefined
  try {
    const url = new URL(logo)
    return url.protocol === "https:" ? url.origin : undefined
  } catch {
    return undefined
  }
}

/**
 * The https origins, beyond the page's own site, the header may draw images
 * from: the logo's, when it lives on another host, and the deployment's media
 * host (`mediaOrigin` in the runtime config), each once. Anything else the
 * header would draw from another origin shows its stand-in instead.
 */
export function imageOriginsFor(logo: string | undefined, mediaOrigin: string | undefined): string[] {
  return [...new Set([logoOrigin(logo), mediaOrigin])].filter((origin): origin is string => origin !== undefined)
}

/** A figure the header shows; one the server could not give stays unknown (the header's "…"), never 0. */
function shown(figure: number | null | undefined): number {
  return (figure ?? undefined) as number
}

/**
 * The balance as the white-label header draws it: the app hands it the figures
 * the sidebar card would show.
 *   - the headline the card picks (`spendableCredits`): the caller's
 *     allowance on a deployment with a single payer, an outside wallet's
 *     available figure where one funds the runs, the balance otherwise;
 *   - the meter is what is left of the allowance, and an outside wallet has
 *     none. The header draws a month meter only beside the account's own
 *     wallet, so the allowance goes to it AS that wallet: with no `allowance`
 *     key for it to read, its figures as the wallet's (and `display`'s, which
 *     the header reads in a unit);
 *   - in the deployment's own unit when the server converted the figures
 *     (`display`), else in credits. The app never converts: a figure the
 *     server did not convert is shown as it came;
 *   - the unit named in the viewer's language (`locale`): the word the server
 *     sent for it (`display.unitLabels`), else its single label. The header
 *     reads `display.unit` as it is and needs nothing of the map.
 * A balance with none of these is handed over as it is.
 */
export function headerBalance(balance: UserBalance, locale: string): UserBalance {
  // A display never refuses, so whether the deployment has a payer at all does not move it.
  const { allowance } = spendableCredits(balance, false)
  const external = balance.externalWallet
  const display = balance.display
  if (!display) {
    if (external) return { ...balance, total: shown(external.available), monthlyAllocation: 0 }
    if (allowance) return { ...balance, allowance: null, total: allowance.remaining, subscription: allowance.remaining, monthlyAllocation: allowance.granted }
    return balance
  }
  const welcome =
    balance.welcomeOffer && display.welcomeOffer
      ? { welcomeOffer: { ...balance.welcomeOffer, credits: shown(display.welcomeOffer.credits) } }
      : {}
  const unit = surfaceUnitLabel(display.unitLabels, locale, display.unit)
  const figure = spendableDisplayFigure(balance, display)
  if (external) return { ...balance, ...welcome, total: shown(figure), monthlyAllocation: 0, display: { ...display, unit } }
  const figures = allowance
    ? { total: figure, subscription: display.allowance?.remaining ?? 0, monthlyAllocation: display.allowance?.granted ?? 0 }
    : { total: figure, subscription: display.subscription ?? 0, monthlyAllocation: display.monthlyAllocation ?? 0 }
  return {
    ...balance,
    ...welcome,
    ...(allowance ? { allowance: null } : {}),
    total: shown(figures.total),
    subscription: figures.subscription,
    monthlyAllocation: figures.monthlyAllocation,
    display: { ...display, ...figures, unit },
  }
}

/**
 * The SDK client as the white-label header gets it: the same client, whose
 * `credits.balance()` answers `headerBalance` of the balance, in the language
 * on screen when it is read (`locale`). Every other call is the client's own
 * (a resource's methods run on the resource itself).
 */
export function withHeaderBalance(sdk: NodaroClient, locale: () => string): NodaroClient {
  const balance = async () => headerBalance(await sdk.credits.balance(), locale())
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
 * the keys whose sentences say "credits", and the header's own sentences for a
 * unit (the pill, its screen-reader line, the account menu's caption and
 * meter), are worded with `words`; every other key is the header's own. `null`
 * (no unit: the figures are credits) is the header's translator unchanged.
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
      case "credits.balanceUnit":
        return words.balance(text(vars?.amount))
      case "credits.pill":
        return words.pill(text(vars?.credits))
      case "credits.pillUnit":
        return words.pill(text(vars?.amount))
      case "credits.loading":
        return words.loading
      case "account.creditsLeft":
      case "account.unitsLeft":
        return words.left
      case "account.monthMeter":
      case "account.monthMeterUnit":
        return words.meter(text(vars?.left), text(vars?.total))
      default:
        return t(key, vars)
    }
  }
}
