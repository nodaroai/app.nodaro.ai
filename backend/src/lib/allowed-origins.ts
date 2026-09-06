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
export interface HostRequestLike {
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

/**
 * The host the browser used — `x-forwarded-host` as the edge proxy set it, else
 * the `Host` header. Lower-cased, **port kept**: this is a URL `host` (the
 * `hostname:port` form), so `localhost:3000` and `localhost:5173` stay distinct.
 *
 * Deliberately does NOT read `x-forwarded-proto`: the edge owns the scheme and
 * rewrites it (Caddy replaces the header with the scheme IT received unless the
 * peer is a trusted proxy), so a scheme derived here would be the proxy's, not
 * the browser's. Nothing this file decides needs it.
 */
export function requestHost(req: HostRequestLike): string | null {
  const raw = firstHeaderEntry(req.headers["x-forwarded-host"]) ?? firstHeaderEntry(req.headers.host)
  return raw ? raw.toLowerCase() : null
}

/**
 * The same value with the port stripped — the key form for a per-host map (the
 * SSO `initiateUrlByHost`), which is deliberately port-agnostic where
 * `requestHost` above is not. A bracketed IPv6 literal keeps its brackets, which
 * is how it is written in a Host header.
 */
export function requestHostname(req: HostRequestLike): string | null {
  const host = requestHost(req)
  if (!host) return null
  if (host.startsWith("[")) {
    const close = host.indexOf("]")
    return close === -1 ? host : host.slice(0, close + 1)
  }
  const colon = host.indexOf(":")
  return colon === -1 ? host : host.slice(0, colon)
}

/** The allowlist reduced to `host` (hostname + non-default port). Rebuilt only
 *  when getStaticAllowedOrigins() hands back a different array. */
let cachedAllowedHosts: { from: string[]; hosts: Set<string> } | null = null
function allowedHosts(): Set<string> {
  const origins = getStaticAllowedOrigins()
  if (!cachedAllowedHosts || cachedAllowedHosts.from !== origins) {
    const hosts = new Set<string>()
    for (const o of origins) {
      // An operator's CORS_ORIGIN entry is free text; a non-URL is skipped
      // rather than throwing on a login request.
      try {
        hosts.add(new URL(o).host.toLowerCase())
      } catch {
        /* not a URL — it could never have matched an Origin header either */
      }
    }
    cachedAllowedHosts = { from: origins, hosts }
  }
  return cachedAllowedHosts.hosts
}

/**
 * Whether this request arrived on one of the operator's own hostnames.
 *
 * HOST-based, not origin-based, on purpose: the one decision it drives is
 * "redirect relative", and a relative redirect never needs a scheme — the
 * browser resolves it against the page it is already on. Comparing schemes would
 * only import the edge proxy's rewriting of `X-Forwarded-Proto` into an answer
 * that has nothing to do with the scheme.
 */
export function isAllowedRequestHost(req: HostRequestLike): boolean {
  const host = requestHost(req)
  return host !== null && allowedHosts().has(host)
}
