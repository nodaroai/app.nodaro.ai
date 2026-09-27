import { runtimeApiUrl } from "@/lib/runtime-config"

/**
 * A webhook trigger's server-relative path (`/v1/webhooks/<token>`, as
 * `GET /v1/workflows/:id/triggers` returns it) as the absolute URL an outside
 * caller posts to: the API's own base when the deployment names one, else
 * this page's origin, which serves `/v1` itself.
 */
export function webhookEndpointUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const apiBase = runtimeApiUrl().replace(/\/+$/, "")
  const base = /^https?:\/\//i.test(apiBase) ? apiBase : `${window.location.origin}${apiBase}`
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}
