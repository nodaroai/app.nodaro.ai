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
