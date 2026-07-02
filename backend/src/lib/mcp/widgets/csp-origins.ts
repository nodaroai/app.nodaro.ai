import { config } from "../../config.js"

/**
 * Single source of truth for the widget CSP resource-domain allowlist.
 *
 * Consumed by (1) registrar.ts — the `_meta.ui.csp.resourceDomains` the host
 * enforces on every widget iframe, and (2) job-auto.ts — the widget's own
 * classify logic, which downgrades off-allowlist media URLs to external links
 * instead of letting the host hard-block the <img>/<video> load with
 * "Refused to load — violates img-src directive".
 *
 * The list is derived from the deployment's media config (R2_PUBLIC_URL +
 * R2_PUBLIC_FALLBACK_DOMAIN) so self-hosted media renders inline in widgets;
 * the Nodaro Cloud domains stay as static defaults so an unset env preserves
 * Cloud behavior exactly.
 */

const DEFAULT_MEDIA_ORIGINS = [
  "https://cdn.nodaro.ai",
  "https://assets.nodaro.ai",
  "https://*.r2.cloudflarestorage.com",
]

/** Normalize a configured URL or bare host to an https origin (null if unusable). */
function toOrigin(value: string): string | null {
  if (!value) return null
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin
  } catch {
    return null
  }
}

export const WIDGET_MEDIA_ORIGINS: readonly string[] = [
  ...new Set(
    [
      ...DEFAULT_MEDIA_ORIGINS,
      toOrigin(config.R2_PUBLIC_URL),
      toOrigin(config.R2_PUBLIC_FALLBACK_DOMAIN),
    ].filter((origin): origin is string => origin !== null),
  ),
]
