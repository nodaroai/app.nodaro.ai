import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"
import {
  USAGE_MODES,
  LOCATION_REFERENCE_PHOTO_KINDS,
  DEFAULT_LABEL_BY_SOURCE,
  type ReferenceSource,
} from "@nodaro/shared"

/**
 * Route-level Zod schema for a `@nodaro/shared` `ConnectedReference` — the SSOT
 * shared by every route that accepts structured references server-side
 * (`generate-image`, `generate-video`, …).
 *
 * A FAITHFUL mirror of the shared `ConnectedReference` interface — NOT a blind
 * passthrough — so a thin client (Studio / the MCP route) can hand the route the
 * same structured reference data the frontend assembles client-side today, and
 * the route assembles it server-side (image → `assembleImageInput`; video →
 * `resolveVideoReferenceCore`).
 *
 * SSRF parity: `url` MUST go through `safeUrlSchema` (same syntactic gate as the
 * flat `referenceImageUrls`), so a structured-path ref pointing at localhost / a
 * private IP / a non-http(s) scheme is rejected at the route boundary exactly
 * like a flat ref. The remaining fields are optional metadata the prompt
 * assemblers read when composing identity directives.
 *
 * Enums are derived from the shared sources of truth (`USAGE_MODES`,
 * `LOCATION_REFERENCE_PHOTO_KINDS`, and the `ReferenceSource` union via
 * `DEFAULT_LABEL_BY_SOURCE`'s keys) rather than hardcoded, so the schema can
 * never drift from the catalog.
 *
 * NOTE: the ENUMS are derived (can't drift) but the FIELD SET is hand-mirrored,
 * so a new optional field on the shared `ConnectedReference` would be silently
 * stripped here (no `.strict()`) without a test pinning the keys to the type —
 * see the key-set drift guard in `__tests__/generate-image.test.ts`.
 */
const REFERENCE_SOURCES = Object.keys(DEFAULT_LABEL_BY_SOURCE) as [
  ReferenceSource,
  ...ReferenceSource[],
]

export const connectedReferenceSchema = z.object({
  id: z.string(),
  defaultName: z.string(),
  source: z.enum(REFERENCE_SOURCES),
  description: z.string().optional(),
  url: safeUrlSchema,
  characterSlug: z.string().optional(),
  variantSlug: z.string().optional(),
  characterCanonicalDescription: z.string().nullable().optional(),
  elementInjection: z.string().nullable().optional(),
  locationCanonicalDescription: z.string().nullable().optional(),
  locationSlug: z.string().optional(),
  locationVariantBucket: z.string().optional(),
  locationVariantSlug: z.string().optional(),
  locationVariantDisplayName: z.string().optional(),
  locationReferencePhotoKind: z.enum(LOCATION_REFERENCE_PHOTO_KINDS).optional(),
  variantDescription: z.string().nullable().optional(),
  variantDisplayName: z.string().optional(),
  defaultUsageMode: z.enum(USAGE_MODES).optional(),
  isExtraRef: z.boolean().optional(),
  loraReplicateVersion: z.string().nullable().optional(),
  loraTriggerWord: z.string().nullable().optional(),
  loraTrainingStatus: z.string().nullable().optional(),
  // Opt-in (default-off) per-reference identity-lock — Unified Reference Roles.
  // When `enabled`, the prompt builder prepends a fidelity line for this ref
  // (`text` overrides the built-in wording; `{ref}` is the reference's binding).
  // The one new structured-shape field exposed to API/MCP/SDK callers.
  identityLock: z
    .object({ enabled: z.boolean(), text: z.string().optional() })
    .optional(),
})
