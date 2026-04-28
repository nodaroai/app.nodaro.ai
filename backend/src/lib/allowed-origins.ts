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
