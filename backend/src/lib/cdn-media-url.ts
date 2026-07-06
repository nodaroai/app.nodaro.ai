import { z } from "zod"
import { config } from "./config.js"
import { isOurCdnUrl } from "./cdn-host.js"

/**
 * Our-CDN-only URL gate for media (image now, video later). Deliberately
 * stricter than `safeUrlSchema` (which admits any public host) — media URLs
 * must resolve to the Nodaro CDN, matching the Phase-3c `logo.image` gate.
 * Lives in a leaf module (not plan-schemas.ts) so both plan-schemas.ts and
 * blueprint-params.ts can import it without a circular dependency.
 */
export const cdnMediaUrlSchema = z
  .string()
  .url()
  .refine((u) => isOurCdnUrl(u, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN), {
    message: "must be an https URL on the Nodaro CDN",
  })
