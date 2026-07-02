/**
 * Single source of truth for the widget CSP resource-domain allowlist.
 *
 * Consumed by (1) registrar.ts — the `_meta.ui.csp.resourceDomains` the host
 * enforces on every widget iframe, and (2) job-auto.ts — the widget's own
 * classify logic, which downgrades off-allowlist media URLs to external links
 * instead of letting the host hard-block the <img>/<video> load with
 * "Refused to load — violates img-src directive".
 */
export const WIDGET_MEDIA_ORIGINS = [
  "https://cdn.nodaro.ai",
  "https://assets.nodaro.ai",
  "https://*.r2.cloudflarestorage.com",
] as const
