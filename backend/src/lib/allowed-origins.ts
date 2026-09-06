import { config } from "./config.js"

interface AllowedOriginsInput {
  corsOrigin: string
  publicUrl: string
}

/**
 * Compute the static CORS allowlist from env vars.
 * Always includes localhost dev origins. Adds PUBLIC_URL and CORS_ORIGIN entries.
 * No hardcoded production domains — operators set PUBLIC_URL to their instance URL.
 */
export function computeAllowedOrigins(input: AllowedOriginsInput): string[] {
  const set = new Set<string>([
    "http://localhost:3000",
    "http://localhost:5173",
  ])

  if (input.publicUrl) set.add(input.publicUrl)

  if (input.corsOrigin) {
    for (const o of input.corsOrigin.split(",")) {
      const trimmed = o.trim()
      if (trimmed) set.add(trimmed)
    }
  }

  return [...set]
}

/** Check if an origin is in the allowlist. Returns false for undefined. */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false
  return allowed.includes(origin)
}

/** Convenience: compute from `config` module. Cached at module-load time. */
let cached: string[] | null = null
export function getStaticAllowedOrigins(): string[] {
  if (!cached) {
    cached = computeAllowedOrigins({
      corsOrigin: config.CORS_ORIGIN,
      publicUrl: config.PUBLIC_URL,
    })
  }
  return cached
}

/**
 * The "front door" URL of this Nodaro instance — used in OG tags, embed redirects,
 * email links, etc. Order: PUBLIC_URL > first CORS_ORIGIN > localhost dev.
 */
export function getPublicAppUrl(input: AllowedOriginsInput): string {
  if (input.publicUrl) return input.publicUrl
  if (input.corsOrigin) {
    const first = input.corsOrigin.split(",")[0]?.trim()
    if (first) return first
  }
  return "http://localhost:3000"
}

let cachedPublicAppUrl: string | null = null
export function getStaticPublicAppUrl(): string {
  if (cachedPublicAppUrl === null) {
    cachedPublicAppUrl = getPublicAppUrl({
      corsOrigin: config.CORS_ORIGIN,
      publicUrl: config.PUBLIC_URL,
    })
  }
  return cachedPublicAppUrl
}

/**
 * The parts of a request these helpers read — headers, nothing else. A
 * structural type (a `FastifyRequest` satisfies it) so they stay pure and can be
 * unit-tested with a hand-built object.
 */
export interface OriginRequestLike {
  headers: Record<string, string | string[] | undefined>
}

/**
 * First value of a possibly-repeated header. `x-forwarded-*` arrives as an array
 * (repeated header) or as a comma-separated chain when several proxies appended
 * to it; the FIRST entry is the one the client actually reached.
 *
 * A local one-liner rather than an import of `request-helpers.js` for the reason
 * job-source.ts documents (that module is routinely partial-mocked by route
 * suites, and this file is on the CORS path of every request) — and because the
 * comma split is specific to the forwarded headers.
 */
function firstHeaderEntry(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v
  const first = raw?.split(",")[0]?.trim()
  return first || undefined
}

/** The host the browser used, as forwarded by Caddy (`host` when nothing is). */
function forwardedHost(req: OriginRequestLike): string | undefined {
  return firstHeaderEntry(req.headers["x-forwarded-host"]) ?? firstHeaderEntry(req.headers.host)
}

/**
 * The origin THIS request arrived on, derived from the proxy's forwarded
 * headers: `${x-forwarded-proto ?? "https"}://${x-forwarded-host ?? host}`.
 * Keeps the port — an origin is scheme + host + port, and `http://localhost:5173`
 * must match the allowlist entry of the same name. Lower-cased: DNS is
 * case-insensitive but `Array.includes` is not.
 *
 * `null` when the request carries no host at all (HTTP/1.0 without a Host).
 */
export function requestOrigin(req: OriginRequestLike): string | null {
  const host = forwardedHost(req)
  if (!host) return null
  const proto = firstHeaderEntry(req.headers["x-forwarded-proto"]) ?? "https"
  return `${proto.toLowerCase()}://${host.toLowerCase()}`
}

/** Whether this request arrived on one of the operator's own origins. */
export function isAllowedRequestOrigin(req: OriginRequestLike): boolean {
  return isOriginAllowed(requestOrigin(req) ?? undefined, getStaticAllowedOrigins())
}

/**
 * The bare hostname this request arrived on — lower-cased, port stripped — for
 * keying a per-host map (the SSO `initiateUrlByHost`). A bracketed IPv6 literal
 * keeps its brackets, which is how it is written in a Host header.
 */
export function requestHost(req: OriginRequestLike): string | null {
  const raw = forwardedHost(req)
  if (!raw) return null
  const host = raw.toLowerCase()
  if (host.startsWith("[")) {
    const close = host.indexOf("]")
    return close === -1 ? host : host.slice(0, close + 1)
  }
  const colon = host.indexOf(":")
  return colon === -1 ? host : host.slice(0, colon)
}
