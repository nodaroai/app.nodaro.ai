import { matchRoutes, type NavigateFunction, type RouteObject } from "react-router-dom"
import { leaveTo } from "@/lib/leave-page"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

/**
 * Where a completed sign-in goes, and how it gets there — one rule for every
 * way in: email and password, Google and the native single sign-on providers
 * (both come back through /auth/callback), and the SSO assertion exchange
 * (the /sso landing).
 *
 * The destination is a path on THIS site, carried as the login page's
 * `?redirect=` (or `?return_to=`) and kept in localStorage across a provider
 * round trip. It may be one of this app's own pages, or a page of another
 * product served from the same site (a white-label deployment serves every
 * product from one host: `/voice-changer/…`, `/image`, `/video/…`). The app's
 * own pages open in place, as they always have; any other path gets a full
 * page load, so the site's other product answers it instead of this app's
 * not-found page.
 *
 * A full page load can leave the site, so the destination is checked the way
 * the browser would follow it, never by its characters alone: `/\host`, a
 * tab or line break the browser drops (`/<TAB>/host`), and a path whose dot
 * segments resolve to `//host` all name another site, and are refused.
 */

/** Where a sign-in goes when nothing (or nothing safe) names a destination. */
export const DEFAULT_SIGN_IN_PATH = "/projects"

/** A site no address belongs to: a path is resolved against it, and must stay on it. */
const NOWHERE = "https://sign-in.invalid"

/**
 * `raw` as a path on this site — its pathname, query and hash — when the
 * browser, following it, would stay on this site; else null.
 */
export function sameSitePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null
  let url: URL
  try {
    url = new URL(raw, NOWHERE)
  } catch {
    return null
  }
  if (url.origin !== NOWHERE || url.pathname.startsWith("//")) return null
  return `${url.pathname}${url.search}${url.hash}`
}

let appRoutes: RouteObject[] | null = null

/** The app's route tree (`router.routes`), registered once by the router itself; null forgets it. */
export function registerAppRoutes(routes: RouteObject[] | null): void {
  appRoutes = routes
}

/**
 * Whether `path` is one of this app's own pages: a route of the live tree
 * other than the not-found catch-all. Read from the router itself, so a page
 * a build or a deployment leaves out (an admin page, a hidden gallery) is not
 * one, and a new page needs no list. With no tree registered (a component
 * rendered on its own), every path is: the in-place navigation of before.
 */
export function isAppPath(path: string): boolean {
  if (appRoutes === null) return true
  const matches = matchRoutes(appRoutes, path)
  if (!matches || matches.length === 0) return false
  return matches[matches.length - 1].route.path !== "*"
}

/**
 * Go where a completed sign-in goes: `raw` when it is a path on this site,
 * else the default. One of this app's pages opens in place (replacing the
 * sign-in in the history); any other page of this site by a full page load.
 */
export function followSignInRedirect(navigate: NavigateFunction, raw: unknown): void {
  const target = sameSitePath(raw) ?? DEFAULT_SIGN_IN_PATH
  if (isAppPath(target)) navigate(target, { replace: true })
  else leaveTo(target)
}

/** Keep the login page's destination across a provider round trip. Nothing unsafe is kept. */
export function rememberSignInRedirect(raw: unknown): void {
  const path = sameSitePath(raw)
  if (path === null) return
  try {
    localStorage.setItem(AUTH_REDIRECT_KEY, path)
  } catch {
    // storage blocked: the sign-in still works and lands on the default
  }
}

/** The kept destination, consumed (it is read once); null when none, or none that is safe. */
export function takeSignInRedirect(): string | null {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(AUTH_REDIRECT_KEY)
    localStorage.removeItem(AUTH_REDIRECT_KEY)
  } catch {
    return null
  }
  return sameSitePath(stored)
}
