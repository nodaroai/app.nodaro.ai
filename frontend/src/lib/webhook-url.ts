import { runtimeApiUrl, runtimeIsOnMovedHost, runtimeLinkOrigin } from "@/lib/runtime-config"

/**
 * A webhook trigger's server-relative path (`/v1/webhooks/<token>`, as
 * `GET /v1/workflows/:id/triggers` returns it) as the absolute URL an outside
 * caller posts to: on a host a moved deployment names (the Flow host's calls are
 * same-origin, but a webhook URL is for the outside), the deployment's public
 * host; anywhere else, as ever, the API's own base when the deployment names
 * one, else this page's origin, which serves `/v1` itself. `currentOrigin`
 * stands in for the page's in tests.
 */
export function webhookEndpointUrl(path: string, currentOrigin: string = window.location.origin): string {
  if (/^https?:\/\//i.test(path)) return path
  const apiBase = (runtimeIsOnMovedHost(currentOrigin) ? runtimeLinkOrigin() : runtimeApiUrl(currentOrigin)).replace(/\/+$/, "")
  const base = /^https?:\/\//i.test(apiBase) ? apiBase : `${currentOrigin}${apiBase}`
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}
