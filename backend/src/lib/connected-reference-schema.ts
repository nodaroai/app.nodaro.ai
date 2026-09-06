import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"
import { USAGE_MODES, DEFAULT_LABEL_BY_SOURCE, type ReferenceSource, LOCATION_REFERENCE_PHOTO_KINDS } from "@nodaro/shared"

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
  /**
   * Which character asset bucket this entry came from ("boards", "sheets",
   * "expressions", …); undefined = the canonical portrait entry. DISPLAY
   * metadata only — never affects payload numbering or prompt assembly.
   */
  bucket: z.string().optional(),
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
  // Character node's HYBRID default role (Character Node Role+Lock) — a curated
  // preset or sanitized Custom slug; free-string here (same trust class as
  // `description`: prompt-affecting metadata from an authenticated caller).
  defaultRole: z.string().optional(),
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
  // PER-USE identity description (Described References). Wins over the entity's
  // stored canonical description wherever one renders; `description` keeps its
  // own label semantics. Same trust class as `description` — prompt-affecting
  // free text from an authenticated caller — so the same `.max(2000)` ceiling
  // the described-reference schema uses.
  descriptionOverride: z.string().max(2000).optional(),
})

/**
 * Route-level Zod schema for a `@nodaro/shared` `DescribedReference` — a
 * reference the caller can NAME and DESCRIBE but has no media for (an un-bound
 * cast role, an analysis slot). The SSOT shared by every route that accepts one.
 *
 * No `url`, so there is no SSRF gate to apply and no reference-image budget to
 * consume: the entry reaches the model purely as prose. Both halves are bounded
 * as prompt-affecting free text from an authenticated caller — the name at the
 * ceiling an entity display name already lives under, the description at the
 * same 2000 as `descriptionOverride`. Neither is `.min(1)`: an un-described role
 * is a real state a client can hold, and the renderer simply drops it rather
 * than 400-ing a run that would otherwise have gone through.
 */
export const describedReferenceSchema = z.object({
  name: z.string().max(80),
  description: z.string().max(2000),
})

/** Wire ceiling for a described-reference list — a cast, not a corpus. */
export const DESCRIBED_REFERENCE_LIMIT = 10

/**
 * A caption for one video / audio rail reference, INDEX-ALIGNED with the
 * caller's `referenceVideoUrls` / `referenceAudioUrls`. Rendered as
 * `@video_N: <caption>.` and bounded by the count of references that actually
 * ship, so a caption can never bind a slot the payload dropped.
 */
export const referenceCaptionSchema = z.string().max(500)
