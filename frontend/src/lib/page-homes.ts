import routeHomes from "@/route-homes.json"
import { leaveTo } from "@/lib/leave-page"
import { runtimeFlowUiOrigin, runtimeLegacyUiHosts, runtimeLinkOrigin } from "@/lib/runtime-config"

/**
 * Where a page's one home is, in the browser, on a deployment that moved its
 * pages to a host of their own (FLOW_UI_ORIGIN). The proxy already sends
 * top-level visits to the right host (tools/gen-route-homes.mjs); this does the
 * same for the navigations that never reach it: a sign-in that lands on the
 * kept host goes on to the app's pages, a link on the app's host to a published
 * page goes back. A framed page (every product's account pop-up) and a pop-up
 * window (a published app's sign-in) are always served where they are. With no
 * such deployment nothing here is installed.
 *
 * It decides exactly as the proxy does, from the same lists
 * (`frontend/src/route-homes.json`): only the pages listed as moved move, an
 * exact page also with its trailing slash, never a file; on the Flow host only
 * the kept-only pages go back; paths are compared as Caddy's path matcher
 * compares them. One address table holds the two to the same answers
 * (tools/__tests__/fixtures/route-home-addresses.json, run against real Caddy
 * and against this). Should they ever disagree, `hopAllowed` stops the second
 * identical hop instead of bouncing the visitor between hosts.
 */

type RouterLocation = { readonly pathname: string; readonly search: string; readonly hash: string }

/**
 * A path as Caddy's path matcher compares it: percent-decoded (`%2F` is a
 * slash), lower case, runs of slashes merged and dot segments resolved, a
 * trailing slash kept. Null when it cannot be decoded: the proxy refuses such
 * a request, so there is nothing to decide.
 */
export function proxyMatchPath(rawPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  const lower = decoded.toLowerCase()
  const segments: string[] = []
  for (const segment of lower.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  const cleaned = `/${segments.join("/")}`
  return cleaned !== "/" && lower.endsWith("/") ? `${cleaned}/` : cleaned
}

/** Whether a list covers the path the way the generated proxy block matches it: `/x/*` as a prefix, an exact page also with its trailing slash. */
function listCovers(entries: readonly string[], path: string): boolean {
  return entries.some((entry) => {
    const pattern = entry.toLowerCase()
    if (pattern.endsWith("/*")) return path.startsWith(pattern.slice(0, -1))
    return path === pattern || (pattern !== "/" && path === `${pattern}/`)
  })
}

function isFile(path: string): boolean {
  return routeHomes.files.some((extension) => path.endsWith(`.${extension}`))
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

function isFramedOrPopUp(): boolean {
  try {
    return window.self !== window.top || window.opener != null
  } catch {
    return true
  }
}

/**
 * The full URL this navigation must go to instead, or null when this page is
 * the right place for it. `context` stands in for the browser in tests:
 * whether the page is framed, and the page's origin.
 */
export function pageHomeTarget(location: RouterLocation, context: { readonly framed?: boolean; readonly origin?: string } = {}): string | null {
  const flow = runtimeFlowUiOrigin()
  if (flow === "") return null
  if (context.framed ?? isFramedOrPopUp()) return null
  const path = proxyMatchPath(location.pathname)
  if (path === null) return null
  const target = `${location.pathname}${location.search}${location.hash}`
  const hostname = hostnameOf(context.origin ?? window.location.origin)
  if (hostname === null) return null
  // The proxy compares "https://" + the request's host with the Flow origin.
  if (`https://${hostname}` === flow) return listCovers(routeHomes.keptOnly, path) ? `${runtimeLinkOrigin()}${target}` : null
  // A host the deployment does not name (another name the service answers on) is left alone, as the proxy leaves it.
  if (!runtimeLegacyUiHosts().includes(hostname)) return null
  return listCovers(routeHomes.moved, path) && !isFile(path) ? `${flow}${target}` : null
}

const HOP_KEY = "nodaro:page-home-hop"
const HOP_WINDOW_MS = 10_000

/**
 * Whether to leave for `target` now: not when this tab left for the very same
 * address moments ago. Two hosts that disagreed would otherwise bounce a
 * visitor back and forth for good; this stops it after one round trip. With no
 * storage there is no record, and the hop goes ahead.
 */
export function hopAllowed(target: string, now: number = Date.now()): boolean {
  try {
    const last: unknown = JSON.parse(window.sessionStorage.getItem(HOP_KEY) ?? "null")
    if (typeof last === "object" && last !== null && "target" in last && "at" in last && last.target === target && typeof last.at === "number") {
      const since = now - last.at
      if (since >= 0 && since < HOP_WINDOW_MS) return false
    }
    window.sessionStorage.setItem(HOP_KEY, JSON.stringify({ target, at: now }))
  } catch {
    // Storage blocked or full: nothing to remember the hop with.
  }
  return true
}

interface GuardedRouter {
  readonly state: { readonly location: RouterLocation }
  subscribe(listener: (state: { readonly location: RouterLocation }) => void): void
}

/** After every navigation, go to the page's one home when that is not here. No-op on a deployment without the move. */
export function installPageHomeGuard(router: GuardedRouter, leave: (url: string) => void = leaveTo): void {
  if (runtimeFlowUiOrigin() === "") return
  const go = (location: RouterLocation) => {
    const target = pageHomeTarget(location)
    if (target !== null && hopAllowed(target)) leave(target)
  }
  go(router.state.location)
  router.subscribe((state) => go(state.location))
}
