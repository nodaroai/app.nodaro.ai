/**
 * Request-log redaction.
 *
 * Fastify's default request log includes the full req.url. OAuth callback
 * URLs carry secrets as query params — `/v1/social/callback/:platform?code=…
 * &state=…` — so with a plain `logger: true` every social connect wrote a
 * live authorization code into the deployment logs. pino's `redact` option
 * can't fix this: it redacts object PATHS, and the whole URL is one string.
 *
 * So the `req` serializer sanitizes the url string itself: the VALUES of the
 * sensitive query params are replaced, the params themselves stay visible
 * (a log line should still show that a code was present). Applied to every
 * route, not just /v1/social/* — none of these param names carries anything
 * a log needs, and a global rule can't miss a future OAuth route.
 */

const SENSITIVE_QUERY_PARAMS = new Set(["code", "state", "access_token"])

const REDACTED = "[redacted]"

/**
 * Replace the values of sensitive query params. URLs without a sensitive
 * param are returned byte-identical (no re-encoding of unrelated URLs).
 */
export function sanitizeLogUrl(url: string): string {
  const q = url.indexOf("?")
  if (q === -1) return url
  const params = new URLSearchParams(url.slice(q + 1))
  let changed = false
  for (const key of new Set(params.keys())) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      params.set(key, REDACTED)
      changed = true
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url
}

/** The subset of a Fastify request the serializer reads (structural, so the
 *  module has no fastify import and tests can pass plain objects). */
interface LoggableRequest {
  method?: string
  url?: string
  hostname?: string
  ip?: string
  socket?: { remotePort?: number }
}

/**
 * Drop-in replacement for Fastify's default `req` serializer — same shape
 * (method, url, hostname, remoteAddress, remotePort), url sanitized.
 */
export function requestLogSerializer(req: LoggableRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: req.url ? sanitizeLogUrl(req.url) : req.url,
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  }
}
