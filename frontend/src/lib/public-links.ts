import { runtimeIsOnMovedHost, runtimeLinkOrigin } from "./runtime-config"

/**
 * The links handed to someone else — a published app, an embed snippet, a shared
 * presentation, the API examples. On a deployment that moved the app's pages to
 * a host of their own, a page on that host or on a legacy host names the
 * deployment's public origin (PUBLIC_URL), never the Flow host. Anywhere else
 * (a one-host deployment, another host name the service answers on) it names
 * the page's own origin, as ever. `currentOrigin` stands in for the page's in tests.
 */
export function publicLinkOrigin(currentOrigin: string = window.location.origin): string {
  return runtimeIsOnMovedHost(currentOrigin) ? runtimeLinkOrigin() : currentOrigin
}

export function publishedAppUrl(slug: string, currentOrigin?: string): string {
  return `${publicLinkOrigin(currentOrigin)}/app/${slug}`
}

export function embedPageUrl(slug: string, currentOrigin?: string): string {
  return `${publicLinkOrigin(currentOrigin)}/embed/${slug}`
}

export function presentationShareUrl(shareToken: string, currentOrigin?: string): string {
  return `${publicLinkOrigin(currentOrigin)}/present/${shareToken}`
}
